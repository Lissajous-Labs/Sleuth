#include "SleuthEditor.h"
#include "BinaryData.h"
#include <array>
#include <bit>
#include <cstring>
#include <mutex>
#include <optional>
#include <vector>

namespace
{
    using Resource = juce::WebBrowserComponent::Resource;
    constexpr std::size_t maximumFrames = 16384;

    struct ScopeHeader
    {
        std::uint32_t magic{0x6373454au};
        std::uint16_t version{1}, headerBytes{sizeof(ScopeHeader)};
        float sampleRate{};
        std::uint32_t frames{}, dropped{};
        std::uint16_t voices{}, tails{};
        std::uint32_t flags{}, position{};
    };
    static_assert(sizeof(ScopeHeader) == 32 && std::is_trivially_copyable_v<ScopeHeader>);
    static_assert(std::endian::native == std::endian::little, "scope.bin is little-endian on the wire");

    const char *mimeFor(const juce::String &file)
    {
        if (file.endsWith(".html"))
            return "text/html";
        if (file.endsWith(".css"))
            return "text/css";
        if (file.endsWith(".js"))
            return "text/javascript";
        return "application/octet-stream";
    }

    std::optional<Resource> bundled(const juce::String &file)
    {
        for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
        {
            if (file != BinaryData::originalFilenames[i])
                continue;
            int size = 0;
            const auto *data = BinaryData::getNamedResource(BinaryData::namedResourceList[i], size);
            if (data == nullptr || size <= 0)
                return std::nullopt;
            Resource resource;
            const auto *bytes = reinterpret_cast<const std::byte *>(data);
            resource.data.assign(bytes, bytes + size);
            resource.mimeType = mimeFor(file);
            return resource;
        }
        return std::nullopt;
    }

    struct SinglePageBrowser final : juce::WebBrowserComponent
    {
        using juce::WebBrowserComponent::WebBrowserComponent;

        bool pageAboutToLoad(const juce::String &url) override
        {
            return url == getResourceProviderRoot() || url == "about:blank";
        }
    };
}

struct SleuthEditor::Impl
{
    explicit Impl(SleuthProcessor &p) : processor(p), browser(options())
    {
        scratch.resize(maximumFrames * 2);
        processor.tap().attach();
        browser.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
    }

    ~Impl() { processor.tap().detach(); }

    juce::WebBrowserComponent::Options options()
    {
        using Options = juce::WebBrowserComponent::Options;
        return Options{}
            .withBackend(Options::Backend::webview2)
            .withWinWebView2Options(Options::WinWebView2{}
                                        .withBackgroundColour(juce::Colour(0xff1f1d1b))
                                        .withUserDataFolder(juce::File::getSpecialLocation(juce::File::tempDirectory)))
            .withNativeIntegrationEnabled()
            .withKeepPageLoadedWhenBrowserIsHidden()
            .withResourceProvider([this](const juce::String &path) { return provide(path); })
            .withNativeFunction("getView",
                                [this](const juce::Array<juce::var> &, auto complete)
                                {
                                    auto *o = new juce::DynamicObject();
                                    o->setProperty("view", processor.view);
                                    o->setProperty("signal", processor.signalView);
                                    complete(juce::var(o));
                                })
            .withNativeFunction("setView",
                                [this](const juce::Array<juce::var> &args, auto complete)
                                {
                                    if (args.size() >= 2)
                                    {
                                        processor.view = args[0].toString();
                                        processor.signalView = args[1].toString();
                                    }
                                    complete(true);
                                });
    }

    std::optional<Resource> provide(const juce::String &path)
    {
        auto file = path.upToFirstOccurrenceOf("?", false, false).fromLastOccurrenceOf("/", false, false);
        if (file.isEmpty())
            file = "index.html";
        if (file == "scope.bin")
            return scope();
        return bundled(file);
    }

    std::optional<Resource> scope()
    {
        const std::lock_guard lock(mutex);
        std::uint64_t dropped = 0;
        const auto frames = processor.tap().read(cursor, scratch.data(), maximumFrames, dropped);
        ScopeHeader header;
        header.sampleRate = static_cast<float>(processor.rate());
        header.frames = static_cast<std::uint32_t>(frames);
        header.dropped = static_cast<std::uint32_t>(std::min<std::uint64_t>(dropped, 0xffffffffu));
        header.flags = 1u;
        header.position = static_cast<std::uint32_t>(cursor.position);
        Resource resource;
        resource.mimeType = "application/octet-stream";
        resource.data.resize(sizeof(header) + frames * 2 * sizeof(float));
        std::memcpy(resource.data.data(), &header, sizeof(header));
        std::memcpy(resource.data.data() + sizeof(header), scratch.data(), frames * 2 * sizeof(float));
        return resource;
    }

    SleuthProcessor &processor;
    std::mutex mutex;
    sleuth::StereoTap::Cursor cursor;
    std::vector<float> scratch;
    SinglePageBrowser browser;
};

SleuthEditor::SleuthEditor(SleuthProcessor &p) : AudioProcessorEditor(p), impl(std::make_unique<Impl>(p))
{
    addAndMakeVisible(impl->browser);
    setResizable(true, true);
    setResizeLimits(640, 360, 2400, 1600);
    setSize(p.width, p.height);
}

SleuthEditor::~SleuthEditor() = default;

void SleuthEditor::resized()
{
    impl->browser.setBounds(getLocalBounds());
    auto &p = static_cast<SleuthProcessor &>(processor);
    p.width = getWidth();
    p.height = getHeight();
}
