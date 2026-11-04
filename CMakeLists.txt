cmake_minimum_required(VERSION 3.24)
project(Sleuth VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(APPLE)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Minimum macOS version")
endif()

if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/libs/JUCE/CMakeLists.txt")
    message(FATAL_ERROR "JUCE is missing. Run git submodule update --init first.")
endif()
add_subdirectory(libs/JUCE EXCLUDE_FROM_ALL)

set(FORMATS Standalone VST3)
if(APPLE)
    list(APPEND FORMATS AU)
endif()

juce_add_plugin(Sleuth
    COMPANY_NAME "Lissajous Labs"
    BUNDLE_ID "com.lissajouslabs.Sleuth"
    PLUGIN_MANUFACTURER_CODE LsLb
    PLUGIN_CODE Slth
    PRODUCT_NAME "Sleuth"
    FORMATS ${FORMATS}
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    NEEDS_WEB_BROWSER TRUE
    NEEDS_WEBVIEW2 $<BOOL:${WIN32}>
    COPY_PLUGIN_AFTER_BUILD FALSE
    VST3_CATEGORIES Fx Analyzer
    AU_MAIN_TYPE kAudioUnitType_Effect
    HARDENED_RUNTIME_ENABLED TRUE)

file(GLOB WEB_ASSETS CONFIGURE_DEPENDS source/web/*.html source/web/*.css source/web/*.js)
juce_add_binary_data(SleuthWebData SOURCES ${WEB_ASSETS})

target_sources(Sleuth PRIVATE source/SleuthProcessor.cpp source/SleuthEditor.cpp)
target_include_directories(Sleuth PRIVATE source)
target_compile_features(Sleuth PRIVATE cxx_std_20)
target_compile_definitions(Sleuth PUBLIC JUCE_WEB_BROWSER=1 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_REPORT_APP_USAGE=0 JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=$<BOOL:${WIN32}>)
target_link_libraries(Sleuth PRIVATE SleuthWebData juce::juce_audio_utils juce::juce_gui_extra
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
