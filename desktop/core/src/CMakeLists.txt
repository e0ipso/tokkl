# The tokklcore library: the API client, the credential store interface,
# connection state, the timer state client and its event stream, the timer
# controller, the Pomodoro mode store, preferences client and session, and
# the catalogue of Pomodoro sounds. Qt Core and Network only; each companion
# supplies its own credential store and client name.

add_library(tokklcore STATIC
    apitypes.cpp
    apitypes.h
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
    pomodoropreferences.cpp
    pomodoropreferences.h
    pomodorosession.cpp
    pomodorosession.h
    pomodorosounds.cpp
    pomodorosounds.h
    pomodorostore.cpp
    pomodorostore.h
    timercontroller.cpp
    timercontroller.h
    timerstateclient.cpp
    timerstateclient.h
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
