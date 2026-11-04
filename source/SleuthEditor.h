#pragma once

#include "SleuthProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>
#include <memory>

class SleuthEditor final : public juce::AudioProcessorEditor
{
public:
    explicit SleuthEditor(SleuthProcessor &);
    ~SleuthEditor() override;

    void resized() override;

private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
