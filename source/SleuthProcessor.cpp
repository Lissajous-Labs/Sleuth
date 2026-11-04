#include "SleuthProcessor.h"
#include "SleuthEditor.h"

SleuthProcessor::SleuthProcessor()
    : AudioProcessor(BusesProperties()
                         .withInput("Input", juce::AudioChannelSet::stereo(), true)
                         .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
}

void SleuthProcessor::prepareToPlay(double rate, int)
{
    sampleRate.store(rate, std::memory_order_relaxed);
}

bool SleuthProcessor::isBusesLayoutSupported(const BusesLayout &layouts) const
{
    const auto in = layouts.getMainInputChannelSet(), out = layouts.getMainOutputChannelSet();
    return in == out && (out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono());
}

void SleuthProcessor::processBlock(juce::AudioBuffer<float> &buffer, juce::MidiBuffer &)
{
    juce::ScopedNoDenormals noDenormals;
    const auto frames = static_cast<std::size_t>(buffer.getNumSamples());
    const auto *left = buffer.getReadPointer(0);
    const auto *right = buffer.getNumChannels() > 1 ? buffer.getReadPointer(1) : left;
    stereo.push(left, right, frames);
}

juce::AudioProcessorEditor *SleuthProcessor::createEditor()
{
    return new SleuthEditor(*this);
}

void SleuthProcessor::getStateInformation(juce::MemoryBlock &destination)
{
    juce::ValueTree state("Sleuth");
    state.setProperty("view", view, nullptr);
    state.setProperty("signal", signalView, nullptr);
    state.setProperty("width", width, nullptr);
    state.setProperty("height", height, nullptr);
    juce::MemoryOutputStream stream(destination, false);
    state.writeToStream(stream);
}

void SleuthProcessor::setStateInformation(const void *data, int size)
{
    const auto state = juce::ValueTree::readFromData(data, static_cast<std::size_t>(size));
    if (!state.isValid() || state.getType().toString() != "Sleuth")
        return;
    view = state.getProperty("view", view).toString();
    signalView = state.getProperty("signal", signalView).toString();
    width = juce::jlimit(640, 2400, static_cast<int>(state.getProperty("width", width)));
    height = juce::jlimit(360, 1600, static_cast<int>(state.getProperty("height", height)));
}

juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter()
{
    return new SleuthProcessor();
}
