# tokklmacos: the menu bar app without the platform layer. It needs Qt
# Widgets and tokklcore only, so it builds and is tested on any platform.
add_library(tokklmacos STATIC
    loginitem.h
    menubarapp.cpp
    menubarapp.h
    projectindicator.cpp
    projectindicator.h
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
    # The bundle icon: iconutil packs the iconset that npm run icons renders
    # into an icns, which goes to Contents/Resources under the name
    # CFBundleIconFile gives.
    find_program(TOKKL_ICONUTIL iconutil REQUIRED)
    set(_iconset "${CMAKE_CURRENT_SOURCE_DIR}/../resources/${TOKKL_BUNDLE_ICON}.iconset")
    set(_icns "${CMAKE_CURRENT_BINARY_DIR}/${TOKKL_BUNDLE_ICON}.icns")
    set(_iconset_pngs)
    foreach(_points 16 32 128 256 512)
        list(APPEND _iconset_pngs
            "${_iconset}/icon_${_points}x${_points}.png"
            "${_iconset}/icon_${_points}x${_points}@2x.png")
    endforeach()
    add_custom_command(OUTPUT "${_icns}"
        COMMAND "${TOKKL_ICONUTIL}" -c icns -o "${_icns}" "${_iconset}"
        DEPENDS ${_iconset_pngs}
        COMMENT "Packing ${TOKKL_BUNDLE_ICON}.icns"
        VERBATIM)
    set_source_files_properties("${_icns}" PROPERTIES MACOSX_PACKAGE_LOCATION Resources)

    add_executable(tokkl-macos MACOSX_BUNDLE ${_platform_sources} "${_icns}")
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
