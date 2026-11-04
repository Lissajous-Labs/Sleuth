#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace sleuth
{
    class StereoTap final
    {
    public:
        static constexpr std::size_t capacity = std::size_t{1} << 15;

        struct Cursor
        {
            std::uint64_t position{};
            bool primed{};
        };

        void attach() noexcept { readers.fetch_add(1, std::memory_order_acq_rel); }

        void detach() noexcept { readers.fetch_sub(1, std::memory_order_acq_rel); }

        bool attached() const noexcept { return readers.load(std::memory_order_acquire) > 0; }

        std::uint64_t written() const noexcept { return published.load(std::memory_order_acquire); }

        void push(const float *left, const float *right, std::size_t frames) noexcept
        {
            if (frames == 0 || left == nullptr || right == nullptr || !attached())
                return;

            const auto start = published.load(std::memory_order_relaxed);
            const auto end = start + frames;
            const auto skip = frames > capacity ? frames - capacity : std::size_t{};

            claimed.store(end, std::memory_order_relaxed);
            std::atomic_thread_fence(std::memory_order_release);

            for (auto frame = skip; frame < frames; ++frame)
            {
                const auto slot = static_cast<std::size_t>((start + frame) & mask) * 2;
                samples[slot].store(left[frame], std::memory_order_relaxed);
                samples[slot + 1].store(right[frame], std::memory_order_relaxed);
            }

            published.store(end, std::memory_order_release);
        }

        std::size_t read(Cursor &cursor, float *destination, std::size_t maximumFrames,
                         std::uint64_t &dropped) const noexcept
        {
            dropped = 0;
            const auto end = published.load(std::memory_order_acquire);

            if (!cursor.primed || cursor.position > end)
            {
                cursor = {end, true};
                return 0;
            }

            maximumFrames = std::min(maximumFrames, capacity);
            if (destination == nullptr || maximumFrames == 0)
            {
                dropped = end - cursor.position;
                cursor.position = end;
                return 0;
            }

            auto start = cursor.position;
            if (end - start > maximumFrames)
            {
                dropped = end - maximumFrames - start;
                start = end - maximumFrames;
            }

            const auto count = static_cast<std::size_t>(end - start);
            for (std::size_t frame = 0; frame < count; ++frame)
            {
                const auto slot = static_cast<std::size_t>((start + frame) & mask) * 2;
                destination[2 * frame] = samples[slot].load(std::memory_order_relaxed);
                destination[2 * frame + 1] = samples[slot + 1].load(std::memory_order_relaxed);
            }

            std::atomic_thread_fence(std::memory_order_acquire);
            const auto newestClaim = claimed.load(std::memory_order_relaxed);
            const auto oldestIntact = newestClaim > capacity ? newestClaim - capacity : std::uint64_t{};

            std::size_t torn = 0;
            if (start < oldestIntact)
                torn = static_cast<std::size_t>(std::min<std::uint64_t>(count, oldestIntact - start));

            if (torn > 0)
            {
                dropped += torn;
                std::memmove(destination, destination + 2 * torn, (count - torn) * 2 * sizeof(float));
            }

            cursor.position = end;
            return count - torn;
        }

    private:
        static constexpr std::uint64_t mask = capacity - 1;
        static_assert((capacity & (capacity - 1)) == 0, "capacity must be a power of two");
        static_assert(std::atomic<float>::is_always_lock_free, "samples must be lock-free");
        static_assert(std::atomic<std::uint64_t>::is_always_lock_free, "positions must be lock-free");

        alignas(64) std::atomic<std::uint64_t> published{};
        alignas(64) std::atomic<std::uint64_t> claimed{};
        alignas(64) std::atomic<int> readers{};
        alignas(64) std::array<std::atomic<float>, capacity * 2> samples{};
    };
}
