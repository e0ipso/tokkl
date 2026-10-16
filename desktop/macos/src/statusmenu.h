#pragma once

#include <QObject>
#include <QPointer>
#include <QUrl>

#include <memory>

class QAction;
class QMenu;

namespace Tokkl
{

class TimerController;

// The menu of the menu bar item: state, Start or Stop, Project, Billable,
// Reconnect, Open Tokkl, Settings and Quit.
//
// Project sets only the project of the next start and is locked while an
// entry runs: changing it means stopping and starting a new entry. Billable
// sets the next start too and, while an entry runs, edits that entry in
// place. Both are disabled whenever the timer cannot write, so nothing is
// queued for another account. The check marks always show the controller's
// choice, not the click.
class StatusMenu : public QObject
{
    Q_OBJECT

public:
    explicit StatusMenu(TimerController *timer, QObject *parent = nullptr);
    ~StatusMenu() override;

    QMenu *menu() const;
    QMenu *projectMenu() const;
    QAction *stateAction() const;
    QAction *toggleAction() const;
    QAction *billableAction() const;
    QAction *reconnectAction() const;
    QAction *openAction() const;
    QAction *settingsAction() const;
    QAction *quitAction() const;

Q_SIGNALS:
    void openRequested(const QUrl &url);
    void settingsRequested();
    void quitRequested();

private:
    void rebuildProjects();
    void refresh();
    void refreshState();
    void onGenerationChanged();
    void watchConnection();

    QPointer<TimerController> m_timer;
    std::unique_ptr<QMenu> m_menu;
    QMenu *m_projectMenu = nullptr;
    QAction *m_stateAction = nullptr;
    QAction *m_toggleAction = nullptr;
    QAction *m_billableAction = nullptr;
    QAction *m_reconnectAction = nullptr;
    QAction *m_openAction = nullptr;
    QAction *m_settingsAction = nullptr;
    QAction *m_quitAction = nullptr;
    QMetaObject::Connection m_generationWatch;
};

}
