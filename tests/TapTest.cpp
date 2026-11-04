#include "StereoTap.h"
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <memory>
#include <thread>
#include <vector>

namespace
{
    int checks = 0, failures = 0;

    void check(bool condition, const char *what)
    {
        ++checks;
        if (!condition)
        {
            ++failures;
            std::printf("FAIL: %s\n", what);
        }
    }

    void stereoTap()
    {
        constexpr std::size_t window = 4096;
        const auto tap = std::make_unique<sleuth::StereoTap>();
        std::vector<float> left(sleuth::StereoTap::capacity + 1000), right(left.size()), out(2 * window);
        for (std::size_t i = 0; i < left.size(); ++i)
        {
            left[i] = static_cast<float>(i);
            right[i] = -static_cast<float>(i);
        }

        sleuth::StereoTap::Cursor cursor;
        std::uint64_t dropped = 0;
        tap->push(left.data(), right.data(), 256);
        check(tap->written() == 0, "the tap ignores audio while no reader is attached");

        tap->attach();
        check(tap->read(cursor, out.data(), window, dropped) == 0, "a fresh cursor starts at the newest frame");
        tap->push(left.data(), right.data(), 1000);
        auto count = tap->read(cursor, out.data(), window, dropped);
        check(count == 1000 && dropped == 0, "pending frames are read in full");
        bool ordered = true;
        for (std::size_t i = 0; i < count; ++i)
            ordered = ordered && out[2 * i] == left[i] && out[2 * i + 1] == right[i];
        check(ordered, "frames arrive interleaved and in order");
        check(tap->read(cursor, out.data(), window, dropped) == 0, "a drained cursor reads nothing");

        tap->push(left.data(), right.data(), left.size());
        count = tap->read(cursor, out.data(), window, dropped);
        check(count == window && dropped == left.size() - window, "a backlog keeps only the newest frames");
        check(out[2 * (window - 1)] == left.back() && out[2 * (window - 1) + 1] == right.back(),
              "the newest frame is copied last");

        constexpr std::uint32_t total = 1u << 22;
        std::atomic<bool> finished{};
        sleuth::StereoTap::Cursor reader;
        tap->read(reader, out.data(), window, dropped);
        const auto origin = reader.position;
        const auto base = static_cast<std::uint32_t>(tap->written());
        std::thread writer(
            [&]
            {
                std::vector<float> l(512), r(512);
                std::uint32_t block = 1;
                for (std::uint32_t next = 0; next < total;)
                {
                    const auto n = std::min(block, total - next);
                    for (std::uint32_t i = 0; i < n; ++i)
                    {
                        l[i] = static_cast<float>(base + next + i);
                        r[i] = -l[i];
                    }
                    tap->push(l.data(), r.data(), n);
                    next += n;
                    block = (block * 7 + 13) % 512 + 1;
                }
                finished.store(true, std::memory_order_release);
            });

        bool consistent = true;
        std::uint64_t seen = 0, lost = 0;
        double last = static_cast<double>(origin) - 1.0;
        std::uint64_t discarded = 0;
        for (;;)
        {
            const bool done = finished.load(std::memory_order_acquire);
            const auto n = tap->read(reader, out.data(), window, dropped);
            lost += dropped;
            discarded += dropped;
            for (std::size_t i = 0; i < n; ++i)
            {
                const double expected =
                    i == 0 ? last + 1.0 + static_cast<double>(discarded) : out[2 * (i - 1)] + 1.0;
                consistent = consistent && out[2 * i] == expected && out[2 * i + 1] == -out[2 * i];
            }
            if (n > 0)
            {
                last = out[2 * (n - 1)];
                discarded = 0;
            }
            seen += n;
            if (done && n == 0)
                break;
        }
        writer.join();
        check(consistent, "concurrent reads never return torn or reordered frames");
        check(seen + lost == tap->written() - origin, "every concurrent frame is either delivered or counted lost");
        tap->detach();
        check(!tap->attached(), "the last reader detaches");
    }
}

int main()
{
    stereoTap();
    std::printf("sleuth_tests: %d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
