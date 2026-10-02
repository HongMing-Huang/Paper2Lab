// Paper2Lab — large-scale Kakeya precompute (offline, reproducible).
// Compile: c++ -std=c++17 -O3 -pthread scripts/precompute_kakeya.cpp -o precompute_kakeya
// Run:     ./precompute_kakeya > src/data/kakeya-precomputed.json
//
// Deterministic port of the browser kernels (src/kakeya/*.ts):
//   * Fibonacci-hemisphere directions (golden angle)
//   * mulberry32-seeded spread origins; packing interpolation
//   * exact capsule-vs-voxel-centre distance (segment clamp)
// Multiplicity uses atomic uint16 counters (occupancy-only bitmaps, as in
// bojieli/kakeya-explainer, cannot express multiplicity).
// Output JSON embeds an FNV-1a checksum over all data rows.
#include <atomic>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

static const std::string ALGORITHM_VERSION = "kakeya-voxel-v3-cpp";
static const uint32_t SEED = 20250224u;

struct Vec3 { double x, y, z; };

// state advances as a += K per draw (reference param!) — an earlier revision
// returned the hash and chained on IT, silently forking the RNG stream after
// the first draw; the cross-engine consistency test caught it.
static uint32_t mulberry32(uint32_t& a) {
  a = a + 0x6D2B79F5u;
  uint32_t t = a;
  t = (t ^ (t >> 15)) * (t | 1u);
  t ^= t + (t ^ (t >> 7)) * (t | 61u);
  return t ^ (t >> 14);
}
static double rng01(uint32_t& a) { return mulberry32(a) / 4294967296.0; }

static std::vector<Vec3> fibonacciDirections(int n) {
  std::vector<Vec3> out;
  const double golden = M_PI * (3.0 - std::sqrt(5.0));
  for (int i = 0; i < n; i++) {
    double y = 1.0 - (i + 0.5) / n;
    double r = std::sqrt(std::max(0.0, 1.0 - y * y));
    double th = golden * i;
    out.push_back({std::cos(th) * r, y, std::sin(th) * r});
  }
  return out;
}

struct Tube { Vec3 dir, center; double radius; };

static std::vector<Tube> makeTubes(const std::vector<Vec3>& dirs, double delta, double packing, uint32_t seed) {
  std::vector<Tube> tubes;
  uint32_t a = seed;
  for (const Vec3& d : dirs) {
    double ax = std::fabs(d.x), ay = std::fabs(d.y), az = std::fabs(d.z);
    // spread origin: uniform in the admissible box [a/2, 1 - a/2] per axis
    // (same as src/kakeya/tubes.ts — hi - lo = 1 - a). An earlier revision
    // drew from [a/2, 1 - 1.5a], placing tube cores outside the unit cube;
    // the cross-engine consistency test caught it.
    double lox = ax / 2, loy = ay / 2, loz = az / 2;
    double sx = lox + (1 - ax) * rng01(a);
    double sy = loy + (1 - ay) * rng01(a);
    double sz = loz + (1 - az) * rng01(a);
    tubes.push_back({d,
        {sx + (0.5 - sx) * packing, sy + (0.5 - sy) * packing, sz + (0.5 - sz) * packing},
        delta});
  }
  return tubes;
}

struct Metrics {
  double occupiedVolume, sumTubeVolume, avgMultiplicity;
  long long maxMultiplicity;
};

static Metrics measure(const std::vector<Tube>& tubes, int res) {
  std::vector<std::atomic<uint16_t>> cov(static_cast<size_t>(res) * res * res);
  const double h = 1.0 / res;

  auto worker = [&cov, &tubes, res, h](size_t t0, size_t t1) {
    for (size_t ti = t0; ti < t1; ti++) {
      const Tube& t = tubes[ti];
      const double r = t.radius;
      int minx = std::max(0, (int)std::floor((t.center.x - (std::fabs(t.dir.x) / 2 + r)) * res));
      int maxx = std::min(res - 1, (int)std::ceil((t.center.x + (std::fabs(t.dir.x) / 2 + r)) * res));
      int miny = std::max(0, (int)std::floor((t.center.y - (std::fabs(t.dir.y) / 2 + r)) * res));
      int maxy = std::min(res - 1, (int)std::ceil((t.center.y + (std::fabs(t.dir.y) / 2 + r)) * res));
      int minz = std::max(0, (int)std::floor((t.center.z - (std::fabs(t.dir.z) / 2 + r)) * res));
      int maxz = std::min(res - 1, (int)std::ceil((t.center.z + (std::fabs(t.dir.z) / 2 + r)) * res));
      for (int i = minx; i <= maxx; i++)
        for (int j = miny; j <= maxy; j++)
          for (int k = minz; k <= maxz; k++) {
            double px = (i + 0.5) * h - t.center.x;
            double py = (j + 0.5) * h - t.center.y;
            double pz = (k + 0.5) * h - t.center.z;
            double s = px * t.dir.x + py * t.dir.y + pz * t.dir.z;
            if (s < -0.5) s = -0.5; else if (s > 0.5) s = 0.5;
            double qx = px - s * t.dir.x, qy = py - s * t.dir.y, qz = pz - s * t.dir.z;
            if (qx * qx + qy * qy + qz * qz <= r * r)
              cov[(static_cast<size_t>(i) * res + j) * res + k].fetch_add(1, std::memory_order_relaxed);
          }
    }
  };

  unsigned hw = std::thread::hardware_concurrency();
  int nthreads = static_cast<int>(std::min(8u, hw ? hw : 4u));
  std::vector<std::thread> pool;
  size_t per = (tubes.size() + nthreads - 1) / nthreads;
  for (int t = 0; t < nthreads; t++) {
    size_t a0 = static_cast<size_t>(t) * per;
    size_t a1 = std::min(tubes.size(), a0 + per);
    if (a0 < a1) pool.emplace_back(worker, a0, a1);
  }
  for (auto& th : pool) th.join();

  long long occupied = 0, maxM = 0, total = 0;
  for (auto& c : cov) {
    uint16_t m = c.load(std::memory_order_relaxed);
    total += m;
    if (m > 0) { occupied++; if (m > maxM) maxM = m; }
  }
  double cells = static_cast<double>(res) * res * res;
  return Metrics{static_cast<double>(occupied) / cells,
                 static_cast<double>(total) / cells,
                 occupied > 0 ? static_cast<double>(total) / occupied : 0.0, maxM};
}

static std::string fnv1aHex(const std::string& s) {
  uint64_t h = 1469598103934665603ull;
  for (unsigned char c : s) { h ^= c; h *= 1099511628211ull; }
  std::ostringstream os;
  os << std::hex << std::setfill('0') << std::setw(16) << h;
  return os.str();
}

static std::string fixed(double v, int prec) {
  std::ostringstream os;
  os << std::fixed << std::setprecision(prec) << v;
  return os.str();
}

int mainImpl(int argc, char** argv) {
  struct Cfg { int deltaExp; double packing; int res; };
  const std::vector<int> NS = {64, 128, 256};
  std::vector<Cfg> CFGS = {
      {4, 0.0, 96}, {4, 0.5, 96}, {4, 1.0, 96},
      {5, 0.0, 128}, {5, 0.5, 128}, {5, 1.0, 128},
      {6, 0.0, 192}, {6, 0.5, 192}, {6, 1.0, 192},
  };
  // argv[1] == "large" appends the high-scale tier served by /api/engine —
  // grids beyond what a browser page can compute interactively (AGENTS §3.2).
  if (argc > 1 && std::string(argv[1]) == "large") {
    CFGS.insert(CFGS.end(), {
        {7, 0.0, 256}, {7, 0.5, 256}, {7, 1.0, 256},
        {8, 0.0, 320}, {8, 0.5, 320}, {8, 1.0, 320},
    });
  }
  std::string checksumInput;
  int rowCount = 0;
  std::cout << "{\n";
  std::cout << "  \"script\": \"scripts/precompute_kakeya.cpp\",\n";
  std::cout << "  \"algorithmVersion\": \"" << ALGORITHM_VERSION << "\",\n";
  std::cout << "  \"seed\": " << SEED << ",\n";
  std::cout << "  \"compile\": \"c++ -std=c++17 -O3 -pthread\",\n";
  std::cout << "  \"kernel\": \"exact capsule-vs-voxel-centre distance; atomic uint16 multiplicity\",\n";
  std::cout << "  \"series\": [\n";
  bool first = true;
  for (const Cfg& c : CFGS) {
    double delta = std::pow(2.0, -c.deltaExp);
    for (int n : NS) {
      auto dirs = fibonacciDirections(n);
      auto tubes = makeTubes(dirs, delta, c.packing, SEED);
      Metrics m = measure(tubes, c.res);
      std::ostringstream row;
      row << (first ? "" : ",\n")
          << "    {\"deltaExp\": " << c.deltaExp
          << ", \"delta\": " << fixed(delta, 10)
          << ", \"packing\": " << fixed(c.packing, 2)
          << ", \"res\": " << c.res
          << ", \"n\": " << n
          << ", \"occupiedVolume\": " << fixed(m.occupiedVolume, 8)
          << ", \"sumTubeVolume\": " << fixed(m.sumTubeVolume, 8)
          << ", \"maxMultiplicity\": " << m.maxMultiplicity
          << ", \"avgMultiplicity\": " << fixed(m.avgMultiplicity, 6)
          << "}";
      std::cout << row.str();
      checksumInput += row.str().substr(row.str().find('{'));
      first = false;
      rowCount++;
    }
  }
  std::cout << "\n  ],\n";
  std::cout << "  \"rowCount\": " << rowCount << ",\n";
  std::cout << "  \"checksumFnv1a\": \"" << fnv1aHex(checksumInput) << "\"\n}\n";
  std::cerr << "wrote " << rowCount << " rows, checksum " << fnv1aHex(checksumInput) << "\n";
  return 0;
}

int main(int argc, char** argv) { return mainImpl(argc, argv); }
