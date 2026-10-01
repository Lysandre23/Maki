#pragma once
#include <cmath>
#include <cstdint>
#if defined(_M_X64) || defined(__x86_64__) || defined(__SSE2__)
#include <xmmintrin.h>
#endif

constexpr double kPI = 3.14159265358979323846;

struct Pt { double x = 0, y = 0; };

// The gas fields decay multiplicatively and would sink into denormal numbers,
// which are ~100x slower on x86. Flush them to zero (call once per thread).
inline void enableFastFloats() {
#if defined(_M_X64) || defined(__x86_64__) || defined(__SSE2__)
  _mm_setcsr(_mm_getcsr() | 0x8040); // FTZ | DAZ
#endif
}

inline double clamp(double v, double a, double b) { return v < a ? a : v > b ? b : v; }

// Signed smallest difference a - b, in [-kPI, kPI].
inline double angDiff(double a, double b) {
  double d = a - b;
  while (d > kPI) d -= 2 * kPI;
  while (d < -kPI) d += 2 * kPI;
  return d;
}

// JavaScript Math.round: halves round toward +infinity.
inline double jsround(double x) { return std::floor(x + 0.5); }
// JavaScript Math.sign (0 stays 0).
inline double sign(double x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }
inline double sq(double x) { return x * x; }

// Fast xorshift32 PRNG for VFX/debris/AI. Seeded once by the app.
extern uint32_t g_rndState;
inline void seedRnd(uint32_t s) { g_rndState = s ? s : 1; }
inline double rnd() {
  uint32_t s = g_rndState;
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  g_rndState = s;
  return s / 4294967296.0;
}

// Seeded generator (mulberry32) for battle layouts and reward draws.
struct Rng {
  uint32_t a;
  explicit Rng(uint32_t seed = 1) : a(seed) {}
  double operator()() {
    a += 0x6d2b79f5u;
    uint32_t t = a;
    t = (t ^ (t >> 15)) * (t | 1u);
    t ^= t + (t ^ (t >> 7)) * (t | 61u);
    return (t ^ (t >> 14)) / 4294967296.0;
  }
};

// Stateless integer hash, used for deterministic textures.
inline uint32_t hash(int x, int y) {
  uint32_t h = (uint32_t)x * 374761393u ^ (uint32_t)y * 668265263u;
  h = (h ^ (h >> 13)) * 1274126177u;
  return h ^ (h >> 16);
}
