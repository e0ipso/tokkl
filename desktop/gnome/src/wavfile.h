#pragma once

// Integer PCM RIFF WAVE only: the backend hands samples to the server as is.

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
    // Interleaved frames.
    QByteArray samples;

    int frameSize() const
    {
        return channels * bitsPerSample / 8;
    }
};

std::optional<WavData> readWavFile(const QString &path, QString *error = nullptr);

}
