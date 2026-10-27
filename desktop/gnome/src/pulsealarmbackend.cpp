#include "pulsealarmbackend.h"

#include "wavfile.h"

#include <QThread>

#include <pulse/error.h>
#include <pulse/simple.h>

#include <algorithm>

namespace Tokkl
{

namespace
{
// What the server buffers ahead: enough for a busy machine, little enough
// that a stop is heard at once. The samples go in pieces smaller than
// that, so the thread sees a stop request between two pieces.
constexpr pa_usec_t bufferMicroseconds = 200000;
constexpr pa_usec_t pieceMicroseconds = 50000;

pa_sample_format_t sampleFormat(quint16 bitsPerSample)
{
    switch (bitsPerSample) {
    case 8:
        return PA_SAMPLE_U8;
    case 16:
        return PA_SAMPLE_S16LE;
    case 24:
        return PA_SAMPLE_S24LE;
    case 32:
        return PA_SAMPLE_S32LE;
    default:
        return PA_SAMPLE_INVALID;
    }
}
}

// One playback stream on its own thread. play() starts the thread, which
// connects, writes the samples (once, or until asked to stop) and
// disconnects. stop() asks and waits.
class PulseStream : public QThread
{
    Q_OBJECT

public:
    PulseStream(const QString &applicationName, const QString &name, bool loops, QObject *parent)
        : QThread(parent)
        , m_applicationName(applicationName.toUtf8())
        , m_name(name.toUtf8())
        , m_loops(loops)
    {
    }

    ~PulseStream() override
    {
        stop();
    }

    void play(const QString &file, const WavData &wav)
    {
        stop();
        m_file = file;
        m_wav = wav;
        start();
    }

    void stop()
    {
        requestInterruption();
        wait();
    }

Q_SIGNALS:
    // Emitted from the thread.
    void failed(const QString &message);

protected:
    void run() override
    {
        pa_sample_spec spec;
        spec.format = sampleFormat(m_wav.bitsPerSample);
        spec.rate = m_wav.sampleRate;
        spec.channels = quint8(std::min<quint16>(m_wav.channels, PA_CHANNELS_MAX));
        if (spec.channels != m_wav.channels || !pa_sample_spec_valid(&spec)) {
            Q_EMIT failed(m_file + QStringLiteral(": the sound server does not take %1 channels of %2-bit samples at %3 Hz")
                                       .arg(m_wav.channels)
                                       .arg(m_wav.bitsPerSample)
                                       .arg(m_wav.sampleRate));
            return;
        }
        pa_buffer_attr attributes;
        attributes.maxlength = quint32(-1);
        attributes.tlength = quint32(pa_usec_to_bytes(bufferMicroseconds, &spec));
        attributes.prebuf = quint32(-1);
        attributes.minreq = quint32(-1);
        attributes.fragsize = quint32(-1);
        int error = 0;
        pa_simple *stream = pa_simple_new(nullptr, m_applicationName.constData(), PA_STREAM_PLAYBACK, nullptr, m_name.constData(), &spec, nullptr, &attributes, &error);
        if (!stream) {
            Q_EMIT failed(m_file + QStringLiteral(": ") + QString::fromUtf8(pa_strerror(error)));
            return;
        }

        const qsizetype frame = m_wav.frameSize();
        const qsizetype piece = std::max<qsizetype>(qsizetype(pa_usec_to_bytes(pieceMicroseconds, &spec)) / frame, 1) * frame;
        const qsizetype size = m_wav.samples.size();
        const char *samples = m_wav.samples.constData();
        bool ok = true;
        do {
            for (qsizetype at = 0; at < size && ok && !isInterruptionRequested(); at += piece) {
                const qsizetype count = std::min(piece, size - at);
                if (pa_simple_write(stream, samples + at, size_t(count), &error) < 0) {
                    Q_EMIT failed(m_file + QStringLiteral(": ") + QString::fromUtf8(pa_strerror(error)));
                    ok = false;
                }
            }
        } while (ok && m_loops && !isInterruptionRequested());
        if (ok) {
            if (isInterruptionRequested()) {
                // Drop what the server still holds, so the stop is heard now.
                pa_simple_flush(stream, &error);
            } else {
                // Let the end of the sound play out before the stream closes.
                pa_simple_drain(stream, &error);
            }
        }
        pa_simple_free(stream);
    }

private:
    const QByteArray m_applicationName;
    const QByteArray m_name;
    const bool m_loops;
    QString m_file;
    WavData m_wav;
};

PulseAlarmBackend::PulseAlarmBackend(const QString &applicationName, QObject *parent)
    : QObject(parent)
    , m_alarm(new PulseStream(applicationName, QStringLiteral("Pomodoro alarm"), true, this))
    , m_preview(new PulseStream(applicationName, QStringLiteral("Sound preview"), false, this))
{
    // Across threads, so queued to this object's thread.
    connect(m_alarm, &PulseStream::failed, this, &PulseAlarmBackend::errorOccurred);
    connect(m_preview, &PulseStream::failed, this, &PulseAlarmBackend::errorOccurred);
}

PulseAlarmBackend::~PulseAlarmBackend()
{
    m_alarm->stop();
    m_preview->stop();
}

void PulseAlarmBackend::loop(const QString &file)
{
    play(m_alarm, file);
}

void PulseAlarmBackend::playOnce(const QString &file)
{
    play(m_preview, file);
}

void PulseAlarmBackend::stop()
{
    m_alarm->stop();
}

void PulseAlarmBackend::play(PulseStream *stream, const QString &file)
{
    QString error;
    const std::optional<WavData> wav = readWavFile(file, &error);
    if (!wav) {
        stream->stop();
        Q_EMIT errorOccurred(error);
        return;
    }
    stream->play(file, *wav);
}

}

#include "pulsealarmbackend.moc"
