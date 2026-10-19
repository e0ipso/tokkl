# Assembles the widget package in the build tree, with the Tokkl version
# stamped into its metadata, and installs it as a Plasma applet.

set(_build_dir "${CMAKE_CURRENT_BINARY_DIR}/${TOKKL_PLASMOID_ID}")

tokkl_stamp_metadata(
    INPUT "${CMAKE_CURRENT_SOURCE_DIR}/metadata.json"
    OUTPUT "${_build_dir}/metadata.json"
    VERSION "${TOKKL_RESOLVED_VERSION}"
)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/metadata.json")

# configure_file() re-runs configure when a source changes; the glob picks up
# added or removed files. Start from an empty contents/ so a removed or renamed
# source file does not leave its earlier copy in the package.
file(REMOVE_RECURSE "${_build_dir}/contents")
file(GLOB_RECURSE _contents CONFIGURE_DEPENDS
    RELATIVE "${CMAKE_CURRENT_SOURCE_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}/contents/*")
foreach(_file IN LISTS _contents)
    configure_file("${_file}" "${_build_dir}/${_file}" COPYONLY)
endforeach()

plasma_install_package("${_build_dir}" ${TOKKL_PLASMOID_ID})

# The widget picker resolves KPlugin.Icon through the system icon theme.
install(FILES contents/images/tokkl.png
    DESTINATION "${KDE_INSTALL_ICONDIR}/hicolor/96x96/apps"
    RENAME "${TOKKL_PLASMOID_ID}.png")
