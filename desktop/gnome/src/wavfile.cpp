#include "wavfile.h"

#include <QFile>
#include <QtEndian>

namespace Tokkl
{

namespace
{
// WAVE_FORMAT_PCM: integer samples.
constexpr quint16 pcmFormat = 1;

quint16 u16(const QByteArray &bytes, qsizetype at)
{
    return qFromLittleEndian<quint16>(bytes.constData() + at);
}

quint32 u32(const QByteArray &bytes, qsizetype at)
{
    return qFromLittleEndian<quint32>(bytes.constData() + at);
}

std::optional<WavData> fail(QString *error, const QString &path, const QString &reason)
{
    if (error) {
        *error = path + QStringLiteral(": ") + reason;
    }
    return std::nullopt;
}
}

std::optional<WavData> readWavFile(const QString &path, QString *error)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        return fail(error, path, file.errorString());
    }
    const QByteArray bytes = file.readAll();
    if (bytes.size() < 12 || !bytes.startsWith("RIFF") || bytes.mid(8, 4) != "WAVE") {
        return fail(error, path, QStringLiteral("not a WAV file"));
    }

    // The chunks after the RIFF header: fmt gives the format, data the
    // samples; anything else (LIST, fact, cue) is skipped. Chunks are
    // padded to an even length.
    WavData wav;
    bool haveFormat = false;
    bool haveData = false;
    qsizetype at = 12;
    while (at + 8 <= bytes.size()) {
        const QByteArray id = bytes.mid(at, 4);
        const qsizetype size = u32(bytes, at + 4);
        const qsizetype body = at + 8;
        if (id == "fmt ") {
            if (size < 16 || body + 16 > bytes.size()) {
                return fail(error, path, QStringLiteral("truncated fmt chunk"));
            }
            const quint16 format = u16(bytes, body);
            if (format != pcmFormat) {
                return fail(error, path, QStringLiteral("format %1 is not integer PCM").arg(format));
            }
            wav.channels = u16(bytes, body + 2);
            wav.sampleRate = u32(bytes, body + 4);
            wav.bitsPerSample = u16(bytes, body + 14);
            haveFormat = true;
        } else if (id == "data") {
            if (body + size > bytes.size()) {
                return fail(error, path, QStringLiteral("truncated data chunk"));
            }
            wav.samples = bytes.mid(body, size);
            haveData = true;
            break;
        }
        at = body + size + (size & 1);
    }
    if (!haveFormat) {
        return fail(error, path, QStringLiteral("no fmt chunk"));
    }
    if (!haveData) {
        return fail(error, path, QStringLiteral("no samples"));
    }
    if (wav.channels == 0 || wav.sampleRate == 0) {
        return fail(error, path, QStringLiteral("%1 channels at %2 Hz").arg(wav.channels).arg(wav.sampleRate));
    }
    switch (wav.bitsPerSample) {
    case 8:
    case 16:
    case 24:
    case 32:
        break;
    default:
        return fail(error, path, QStringLiteral("%1-bit samples").arg(wav.bitsPerSample));
    }
    // Whole frames only.
    wav.samples.chop(wav.samples.size() % wav.frameSize());
    if (wav.samples.isEmpty()) {
        return fail(error, path, QStringLiteral("no samples"));
    }
    return wav;
}

}
