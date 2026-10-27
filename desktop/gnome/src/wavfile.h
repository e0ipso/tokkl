#pragma once

// A reader for the bundled sounds: RIFF WAVE files of integer PCM samples,
// which is what the four alarm WAVs are (16-bit mono at 22050 Hz). The
// sound server backend hands the samples to the server as they are, so
// nothing else is accepted.

#include <QByteArray>
#include <QString>

#include <optional>

namespace Tokkl
{

struct WavData {
    quint32 sampleRate = 0;
    quint16 channels = 0;
    // 8, 16, 24 or 32, little-endian; 8-bit samples are unsigned.
    quint16 bitsPerSample = 0;
    // The data chunk: interleaved frames of channels samples each.
    QByteArray samples;

    int frameSize() const
    {
        return channels * bitsPerSample / 8;
    }
};

// Reads the file. For a file that cannot be read or is not integer PCM
// WAVE, returns nullopt and, with error given, says why, naming the file.
std::optional<WavData> readWavFile(const QString &path, QString *error = nullptr);

}
