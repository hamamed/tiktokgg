// TikTokGameListener.cs — Unity client for the TikTok Game Control server.
//
// Requirements
//   * Unity 2021.3+ (.NET Standard 2.1). Works in the Editor and in desktop/mobile builds.
//     WebGL builds can't use System.Net.WebSockets; use the JS client (clients/web) or a WebGL WebSocket plugin there.
//   * Newtonsoft JSON: Package Manager → Add package by name → "com.unity.nuget.newtonsoft-json"
//
// Usage
//   1. Add this component to a GameObject in your scene (e.g. "TikTok").
//   2. Either wire actions in the Inspector (Bindings: actionName -> UnityEvent<int count>)
//      or register them from code:  listener.Register("spawn_train", a => SpawnTrains(a.count));
//   3. Press Play, then open the dashboard. Your action names show up in its picker.
//
// Threading: socket I/O runs on a background task. Every callback is marshalled to the main thread in Update().

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Events;

namespace TikTokGame
{
    // ------------------------------------------------------------------ protocol DTOs (schema/protocol.schema.json)
    [Serializable]
    public class Envelope
    {
        public int v = 1;
        public string type;
        public string id;
        public long ts;
        public string replyTo;
        public JObject payload;
    }

    [Serializable]
    public class TikTokUser
    {
        public string userId;
        public string uniqueId;
        public string nickname;
        public string avatar;
    }

    [Serializable]
    public class GiftInfo
    {
        public string id;
        public string name;
        public double diamonds;
        public string image;
        public int repeatCount;
        public string phase; // "single" | "progress" | "end"  ("end" == repeatEnd === true)
    }

    [Serializable]
    public class ActionSource
    {
        public string kind; // gift | chat | like | follow | share | member | subscribe | manual
        public string ruleId;
        public string ruleName;
        public bool simulated;
        public int units;
        public TikTokUser user;
        public GiftInfo gift;
        public string comment;
        public int likeCount;
    }

    [Serializable]
    public class GameAction
    {
        public string actionId;
        public string action;
        public int count;
        [JsonProperty("params")] public JObject Params;
        public JObject settings;
        public ActionSource source;

        /// <summary>Typed param access with a default, e.g. a.Param("lane", 0).</summary>
        public T Param<T>(string key, T fallback = default)
        {
            var tok = Params?[key];
            if (tok == null || tok.Type == JTokenType.Null) return fallback;
            try { return tok.ToObject<T>(); } catch { return fallback; }
        }
    }

    [Serializable] public class CountEvent : UnityEvent<int> { }

    [Serializable]
    public class ActionBinding
    {
        public string actionName = "spawn_train";
        public CountEvent onAction = new CountEvent();
    }

    // ------------------------------------------------------------------ component
    public class TikTokGameListener : MonoBehaviour
    {
        [Header("Server")]
        [SerializeField] private string serverUrl = "ws://localhost:8080/ws";
        [Tooltip("Must match WS_TOKEN on the server (leave empty if auth is disabled)")]
        [SerializeField] private string token = "";
        [SerializeField] private string clientName = "Unity Game";
        [SerializeField] private bool autoAck = true;

        [Header("Inspector bindings (optional)")]
        [SerializeField] private List<ActionBinding> bindings = new List<ActionBinding>();

        public static TikTokGameListener Instance { get; private set; }

        /// <summary>Fires for every action, handled or not.</summary>
        public event Action<GameAction> OnAnyAction;
        /// <summary>Fires on connect and whenever the dashboard changes a tuning value.</summary>
        public event Action<JObject> OnSettingsChanged;
        public event Action<string> OnStatusChanged;

        public JObject Settings { get; private set; } = new JObject();
        public string Status { get; private set; } = "idle";

        private readonly Dictionary<string, List<Action<GameAction>>> _handlers = new Dictionary<string, List<Action<GameAction>>>();
        private readonly ConcurrentQueue<Action> _mainThread = new ConcurrentQueue<Action>();
        private readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);
        private readonly HashSet<string> _seen = new HashSet<string>();
        private readonly Queue<string> _seenOrder = new Queue<string>();
        private ClientWebSocket _ws;
        private CancellationTokenSource _cts;

        // ---------------------------------------------------------------- public API
        public float GetFloat(string key, float fallback = 1f) =>
            Settings.TryGetValue(key, out var t) && (t.Type == JTokenType.Float || t.Type == JTokenType.Integer) ? t.Value<float>() : fallback;

        public bool GetBool(string key, bool fallback = false) =>
            Settings.TryGetValue(key, out var t) && t.Type == JTokenType.Boolean ? t.Value<bool>() : fallback;

        public bool IsPaused => GetBool("paused");

        /// <summary>Register a code handler. Safe to call any time; the server is told about new action names.</summary>
        public void Register(string action, Action<GameAction> handler)
        {
            if (!_handlers.TryGetValue(action, out var list)) _handlers[action] = list = new List<Action<GameAction>>();
            list.Add(handler);
            if (Status == "open") _ = SendHello();
        }

        public void Unregister(string action, Action<GameAction> handler)
        {
            if (_handlers.TryGetValue(action, out var list)) list.Remove(handler);
        }

        /// <summary>Send arbitrary game state (score, lives…) to the dashboard.</summary>
        public void SendState(object state) => _ = Send("game.state", JObject.FromObject(state));

        // ---------------------------------------------------------------- lifecycle
        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
        }

        private void OnEnable()
        {
            _cts = new CancellationTokenSource();
            _ = RunLoop(_cts.Token);
        }

        private void OnDisable()
        {
            _cts?.Cancel();
            try { _ws?.Abort(); } catch { /* ignore */ }
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        private void Update()
        {
            // Drain socket callbacks on the main thread (Unity API is not thread-safe).
            while (_mainThread.TryDequeue(out var job))
            {
                try { job(); } catch (Exception e) { Debug.LogException(e); }
            }
        }

        // ---------------------------------------------------------------- socket loop (background)
        private async Task RunLoop(CancellationToken ct)
        {
            var retry = 0;
            var uri = new Uri(string.IsNullOrEmpty(token) ? serverUrl : $"{serverUrl}{(serverUrl.Contains("?") ? "&" : "?")}token={Uri.EscapeDataString(token)}");

            while (!ct.IsCancellationRequested)
            {
                try
                {
                    using (_ws = new ClientWebSocket())
                    {
                        SetStatus("connecting");
                        await _ws.ConnectAsync(uri, ct);
                        retry = 0;
                        SetStatus("open");
                        await SendHello();
                        await ReceiveLoop(_ws, ct);
                    }
                }
                catch (OperationCanceledException) { break; }
                catch (Exception e)
                {
                    Debug.LogWarning($"[TikTok] socket: {e.Message}");
                }

                SetStatus("closed");
                if (ct.IsCancellationRequested) break;
                var delay = Math.Min(10_000, 500 * (1 << Math.Min(retry++, 5)));
                try { await Task.Delay(delay, ct); } catch (OperationCanceledException) { break; }
            }
        }

        private async Task ReceiveLoop(ClientWebSocket ws, CancellationToken ct)
        {
            var buffer = new ArraySegment<byte>(new byte[16 * 1024]);
            using (var ms = new MemoryStream())
            {
                while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
                {
                    ms.SetLength(0);
                    WebSocketReceiveResult res;
                    do
                    {
                        res = await ws.ReceiveAsync(buffer, ct);
                        if (res.MessageType == WebSocketMessageType.Close)
                        {
                            if (res.CloseStatus == (WebSocketCloseStatus)4401) Debug.LogError("[TikTok] Unauthorized: check the token");
                            return;
                        }
                        ms.Write(buffer.Array, buffer.Offset, res.Count);
                    } while (!res.EndOfMessage);

                    var json = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
                    _mainThread.Enqueue(() => HandleFrame(json));
                }
            }
        }

        private async Task Send(string type, JObject payload)
        {
            var ws = _ws;
            if (ws == null || ws.State != WebSocketState.Open) return;
            var env = new Envelope { type = type, id = Guid.NewGuid().ToString(), ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), payload = payload };
            var bytes = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(env, new JsonSerializerSettings { NullValueHandling = NullValueHandling.Ignore }));
            await _sendLock.WaitAsync();
            try { await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None); }
            catch (Exception e) { Debug.LogWarning($"[TikTok] send failed: {e.Message}"); }
            finally { _sendLock.Release(); }
        }

        private Task SendHello()
        {
            var actions = _handlers.Keys.Concat(bindings.Select(b => b.actionName)).Where(a => !string.IsNullOrWhiteSpace(a)).Distinct();
            return Send("hello", new JObject
            {
                ["role"] = "game",
                ["name"] = clientName,
                ["actions"] = new JArray(actions),
                ["meta"] = new JObject { ["engine"] = "Unity " + Application.unityVersion, ["platform"] = Application.platform.ToString() },
            });
        }

        private void SetStatus(string s) => _mainThread.Enqueue(() => { Status = s; OnStatusChanged?.Invoke(s); });

        // ---------------------------------------------------------------- dispatch (main thread)
        private void HandleFrame(string json)
        {
            Envelope env;
            try { env = JsonConvert.DeserializeObject<Envelope>(json); }
            catch (Exception e) { Debug.LogWarning($"[TikTok] bad frame: {e.Message}"); return; }
            if (env?.payload == null) return;

            switch (env.type)
            {
                case "game.settings":
                    Settings = env.payload;
                    OnSettingsChanged?.Invoke(Settings);
                    break;

                case "game.action":
                    HandleAction(env.payload.ToObject<GameAction>());
                    break;

                case "error":
                    Debug.LogWarning($"[TikTok] server error: {env.payload["error"]}");
                    break;
            }
        }

        private void HandleAction(GameAction a)
        {
            if (a == null || string.IsNullOrEmpty(a.action) || string.IsNullOrEmpty(a.actionId) || !_seen.Add(a.actionId)) return;
            _seenOrder.Enqueue(a.actionId);
            if (_seenOrder.Count > 500) _seen.Remove(_seenOrder.Dequeue());

            if (a.settings != null) Settings = a.settings;

            var handled = false;
            string error = null;
            try
            {
                if (_handlers.TryGetValue(a.action, out var list))
                    foreach (var h in list.ToArray()) { h(a); handled = true; }

                foreach (var b in bindings)
                    if (b.actionName == a.action) { b.onAction?.Invoke(a.count); handled = true; }

                OnAnyAction?.Invoke(a);
            }
            catch (Exception e)
            {
                error = e.Message;
                Debug.LogException(e);
            }

            if (autoAck)
            {
                var ack = new JObject { ["actionId"] = a.actionId, ["status"] = error != null ? "error" : handled ? "ok" : "ignored" };
                if (error != null) ack["message"] = error;
                _ = Send("game.ack", ack);
            }
        }
    }
}
