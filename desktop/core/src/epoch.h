#pragma once

#include <QPointer>
#include <QtGlobal>

#include <utility>

namespace Tokkl
{

// guard() keeps an answer from reaching its object after the object moved to
// a new context (advance()) or was destroyed.
class Epoch
{
public:
    quint64 value() const
    {
        return m_value;
    }

    void advance()
    {
        ++m_value;
    }

    // The epoch must be a member of owner.
    template<typename Owner, typename F>
    auto guard(Owner *owner, F f) const
    {
        return [self = QPointer<Owner>(owner), epoch = this, at = m_value, f = std::move(f)](auto &&...args) {
            if (self && epoch->m_value == at) {
                f(std::forward<decltype(args)>(args)...);
            }
        };
    }

private:
    quint64 m_value = 0;
};

}
