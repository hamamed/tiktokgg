// TrainGameExample.cs — shows how a Unity game reacts to TikTok actions + live tuning.
// Put it on any GameObject and assign the prefabs/spawn points. Action names are only examples:
// the dashboard maps ANY gift to ANY of these at runtime.

using System.Collections;
using UnityEngine;

namespace TikTokGame
{
    public class TrainGameExample : MonoBehaviour
    {
        [SerializeField] private TikTokGameListener listener;
        [SerializeField] private GameObject trainPrefab;
        [SerializeField] private GameObject obstaclePrefab;
        [SerializeField] private Transform[] lanes;
        [SerializeField] private float baseSpeed = 8f;
        [SerializeField] private float spawnInterval = 0.35f;

        // Live-tunable from the dashboard (game.settings)
        public float Speed => baseSpeed * listener.GetFloat("speedMultiplier", 1f);
        public float Difficulty => listener.GetFloat("difficulty", 1f);

        private int score;
        private float shieldUntil;

        private void Start()
        {
            if (listener == null) listener = TikTokGameListener.Instance;

            listener.Register("spawn_train", a => StartCoroutine(SpawnTrains(a)));
            listener.Register("add_obstacles", a => SpawnObstacles(Mathf.RoundToInt(a.count * Difficulty * listener.GetFloat("obstacleDensity", 1f))));
            listener.Register("shield", a => shieldUntil = Time.time + a.Param("seconds", 5f) * a.count);
            listener.Register("add_score", a => score += a.Param("points", 10) * a.count);
            listener.Register("clear_obstacles", _ => { foreach (var o in GameObject.FindGameObjectsWithTag("Obstacle")) Destroy(o); });

            listener.OnSettingsChanged += s => Debug.Log($"[Game] settings: {s.ToString(Newtonsoft.Json.Formatting.None)}");
            listener.OnAnyAction += a =>
                Debug.Log($"[Game] {a.source?.user?.nickname ?? "host"} → {a.action} ×{a.count} ({a.source?.gift?.name ?? a.source?.kind})");

            InvokeRepeating(nameof(ReportState), 2f, 2f);
        }

        private IEnumerator SpawnTrains(GameAction a)
        {
            // Example params set in the dashboard: { "lane": "random", "cars": 4 }
            var cars = a.Param("cars", 3);
            var laneParam = a.Param<string>("lane", "random");
            for (var i = 0; i < a.count; i++)
            {
                if (listener.IsPaused) yield break;
                var lane = laneParam == "random" || !int.TryParse(laneParam, out var l) ? lanes[Random.Range(0, lanes.Length)] : lanes[Mathf.Clamp(l, 0, lanes.Length - 1)];
                var train = Instantiate(trainPrefab, lane.position, lane.rotation);
                train.transform.localScale = new Vector3(1, 1, cars);
                if (train.TryGetComponent<Rigidbody>(out var rb)) rb.velocity = -lane.forward * Speed;
                yield return new WaitForSeconds(spawnInterval / Mathf.Max(0.1f, listener.GetFloat("spawnRateMultiplier", 1f)));
            }
        }

        private void SpawnObstacles(int n)
        {
            for (var i = 0; i < Mathf.Min(n, 100); i++)
            {
                var lane = lanes[Random.Range(0, lanes.Length)];
                Instantiate(obstaclePrefab, lane.position + lane.forward * Random.Range(10f, 60f), Quaternion.identity);
            }
        }

        private void ReportState() => listener.SendState(new { score, shield = Time.time < shieldUntil, speed = Speed });
    }
}
