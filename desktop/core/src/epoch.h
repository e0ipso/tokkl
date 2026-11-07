#pragma once

#include <QPointer>
#include <QtGlobal>

#include <utility>

namespace Tokkl
{

// Counts the contexts an object goes through, such as the accounts of a
// connection. The answer to a request sent in one context must not reach
// the object once it has moved to the next, or once it is gone; guard()
// wraps the request's callback so it does not.
class Epoch
{
public:
    quint64 value() const
    {
        return m_value;
    }

    // Starts a new context. Callbacks guarded before it do nothing.
    void advance()
    {
        ++m_value;
    }

    // Wraps f so it runs only while owner exists and advance() has not been
    // called since. The epoch must be a member of owner.
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
