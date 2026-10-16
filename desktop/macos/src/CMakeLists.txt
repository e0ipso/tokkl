# tokklmacos: the menu bar app without the platform layer. It needs Qt
# Widgets and tokklcore only, so it builds and is tested on any platform.
add_library(tokklmacos STATIC
    loginitem.h
    menubarapp.cpp
    menubarapp.h
    settingswindow.cpp
    settingswindow.h
    statusitem.h
    statusmenu.cpp
    statusmenu.h
    statuswords.cpp
    statuswords.h
)
target_include_directories(tokklmacos PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(tokklmacos
    PUBLIC
        tokklcore
        Qt6::Widgets
)

# The QtKeychain credential store: the macOS Keychain on macOS. Built
# elsewhere only when QtKeychain is installed, for its tests.
if(Qt6Keychain_FOUND)
    add_library(tokklkeychain STATIC
        keychaincredentialstore.cpp
        keychaincredentialstore.h
    )
    target_include_directories(tokklkeychain PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(tokklkeychain
        PUBLIC
            tokklcore
            Qt6Keychain::Qt6Keychain
    )
endif()

if(APPLE)
    # The app bundle: NSStatusItem, SMAppService and the wiring in main.mm.
    set(_platform_sources
        macloginitem.h
        macloginitem.mm
        macstatusitem.h
        macstatusitem.mm
        main.mm
    )
    add_executable(tokkl-macos MACOSX_BUNDLE ${_platform_sources})
    set_source_files_properties(macloginitem.mm macstatusitem.mm main.mm
        PROPERTIES COMPILE_OPTIONS "-fobjc-arc")
    set_target_properties(tokkl-macos PROPERTIES
        OUTPUT_NAME "${TOKKL_BUNDLE_NAME}"
        MACOSX_BUNDLE_INFO_PLIST "${TOKKL_INFO_PLIST}"
    )
    target_compile_definitions(tokkl-macos PRIVATE
        TOKKL_VERSION_STRING="${TOKKL_RESOLVED_VERSION}"
    )
    target_link_libraries(tokkl-macos
        PRIVATE
            tokklmacos
            tokklkeychain
            "-framework AppKit"
            "-framework ServiceManagement"
    )
    # Signs the whole bundle, ad hoc by default, so codesign can verify it
    # and the Keychain and login items see one app.
    add_custom_command(TARGET tokkl-macos POST_BUILD
        COMMAND codesign --force --sign "${TOKKL_CODESIGN_IDENTITY}" "$<TARGET_BUNDLE_DIR:tokkl-macos>"
        VERBATIM)
endif()
