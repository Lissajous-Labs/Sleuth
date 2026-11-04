# Sleuth

Stereo analyzer plugin by Lissajous Labs: Lissajous, polar and level vectorscopes, mid/side spectrum, waveform, phase correlation, balance, width and peak metering.

## Build

```sh
git submodule update --init
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

Formats: Standalone, VST3, AU (macOS).

## UI preview

```sh
python3 tools/serve.py 8201
```

Open http://localhost:8201 to run the interface against a synthetic signal.
