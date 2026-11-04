#pragma once

#include "StereoTap.h"
#include <juce_audio_processors/juce_audio_processors.h>
#include <atomic>

class SleuthProcessor final : public juce::AudioProcessor
{
public:
    SleuthProcessor();

    void prepareToPlay(double, int) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout &) const override;
    void processBlock(juce::AudioBuffer<float> &, juce::MidiBuffer &) override;
    using AudioProcessor::processBlock;

    juce::AudioProcessorEditor *createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Sleuth"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String &) override {}

    void getStateInformation(juce::MemoryBlock &) override;
    void setStateInformation(const void *, int) override;

    sleuth::StereoTap &tap() noexcept { return stereo; }
    double rate() const noexcept { return sampleRate.load(std::memory_order_relaxed); }

    juce::String view{"liss"}, signalView{"spec"};
    int width{960}, height{520};

private:
    sleuth::StereoTap stereo;
    std::atomic<double> sampleRate{48000.0};
};
