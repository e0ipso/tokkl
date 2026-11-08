# The tokklcore library: the API client, the credential store interface,
# connection state, the timer state client and its event stream, the timer
# controller, the Pomodoro mode store, preferences client and session, and
# the catalogue of Pomodoro sounds. Qt Core and Network only; each companion
# supplies its own credential store and client name.

add_library(tokklcore STATIC
    alarmoutput.h
    apiclient.cpp
    apiclient.h
    apierrors.cpp
    apijson.cpp
    apijson.h
    apipreferences.cpp
    apitimer.cpp
    apitypes.cpp
    apitypes.h
    authsession.cpp
    authsession.h
    chosenproject.cpp
    chosenproject.h
    clock.cpp
    clock.h
    connection.cpp
    connection.h
    connectionsettings.cpp
    connectionsettings.h
    connectionsetup.cpp
    connectionsetup.h
    cooldown.cpp
    cooldown.h
    credentialstore.cpp
    credentialstore.h
    epoch.h
    instanceurl.cpp
    instanceurl.h
    logging.cpp
    logging.h
    menuactions.cpp
    menuactions.h
    mutationgate.cpp
    mutationgate.h
    nextstartdefaults.h
    nextstartselection.cpp
    nextstartselection.h
    pomodoroalarm.cpp
    pomodoroalarm.h
    pomodoropreferences.cpp
    pomodoropreferences.h
    pomodorosession.cpp
    pomodorosession.h
    pomodorosounds.cpp
    pomodorosounds.h
    pomodorostore.cpp
    pomodorostore.h
    projectcatalog.cpp
    projectcatalog.h
    projectchoices.cpp
    projectchoices.h
    projectloader.cpp
    projectloader.h
    sessioncredentials.cpp
    sessioncredentials.h
    sessionstate.h
    settingswrite.cpp
    settingswrite.h
    soundchoices.cpp
    soundchoices.h
    statuspresentation.cpp
    statuspresentation.h
    timeractions.h
    timercontroller.cpp
    timercontroller.h
    timercoordinator.cpp
    timercoordinator.h
    timermodel.cpp
    timermodel.h
    timerstateclient.cpp
    timerstateclient.h
    timerview.cpp
    timerview.h
    transport.cpp
    transport.h
    translations.cpp
    translations.h
)
set_target_properties(tokklcore PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_compile_features(tokklcore PUBLIC cxx_std_20)
target_include_directories(tokklcore PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_definitions(tokklcore PRIVATE
    TOKKL_VERSION_STRING="${TOKKL_CORE_VERSION}"
)
target_link_libraries(tokklcore
    PUBLIC
        Qt6::Core
        Qt6::Network
)
# A companion's QML type registrar reads these for QML_FOREIGN types.
qt6_extract_metatypes(tokklcore)
