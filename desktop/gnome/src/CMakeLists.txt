# tokklgnome: org.tokkl.Timer1 on tokklcore, with the adaptor generated from
# the interface description in dbus/. Qt Core, Network and DBus only, so the
# tests build without QtKeychain.

set(_tokkl_adaptor_sources)
qt_add_dbus_adaptor(_tokkl_adaptor_sources
    "${TOKKL_TIMER1_XML}"
    timerservice.h
    Tokkl::TimerService
    timer1adaptor
    Timer1Adaptor)

add_library(tokklgnome STATIC
    timerservice.cpp
    timerservice.h
    ${_tokkl_adaptor_sources}
)
target_include_directories(tokklgnome
    PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}
    PRIVATE ${CMAKE_CURRENT_BINARY_DIR})
target_link_libraries(tokklgnome
    PUBLIC
        tokklcore
        Qt6::DBus
)

if(TOKKL_GNOME_DAEMON)
    # The QtKeychain credential store, apart so its test can link it.
    add_library(tokklkeychain STATIC
        keychaincredentialstore.cpp
        keychaincredentialstore.h
    )
    target_include_directories(tokklkeychain PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(tokklkeychain
        PUBLIC
            tokklcore
        PRIVATE
            Qt6Keychain::Qt6Keychain
    )

    add_executable(tokkl-timerd main.cpp)
    target_compile_definitions(tokkl-timerd PRIVATE
        TOKKL_VERSION_STRING="${TOKKL_RESOLVED_VERSION}"
    )
    target_link_libraries(tokkl-timerd PRIVATE
        tokklgnome
        tokklkeychain
    )
    install(TARGETS tokkl-timerd RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
endif()
