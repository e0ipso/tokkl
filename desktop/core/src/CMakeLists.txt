# The tokklcore library: the API client, the credential store interface,
# connection state, the timer controller and its pause chain store, the
# Pomodoro cycle and span snapping rules, the Pomodoro store and preferences
# client, and the catalogue of Pomodoro sounds. Qt Core and Network only;
# each companion supplies its own credential store and client name.

add_library(tokklcore STATIC
    apitypes.cpp
    apitypes.h
    chainstore.cpp
    chainstore.h
    clock.cpp
    clock.h
    connection.cpp
    connection.h
    connectionsetup.cpp
    connectionsetup.h
    credentialstore.cpp
    credentialstore.h
    instanceurl.cpp
    instanceurl.h
    pomodorocycle.cpp
    pomodorocycle.h
    pomodoropreferences.cpp
    pomodoropreferences.h
    pomodororecord.cpp
    pomodororecord.h
    pomodorosounds.cpp
    pomodorosounds.h
    pomodorostore.cpp
    pomodorostore.h
    snap.cpp
    snap.h
    timercontroller.cpp
    timercontroller.h
    transport.cpp
    transport.h
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
