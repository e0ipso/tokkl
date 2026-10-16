# The backend QML module the widget imports. The API client, credential
# storage, connection state and timer controller live in the tokklcore
# library, which the module and the tests link; qmltypes.h gives its classes
# their QML names.

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
    timercontroller.cpp
    timercontroller.h
    transport.cpp
    transport.h
)
set_target_properties(tokklcore PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(tokklcore PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_definitions(tokklcore PRIVATE
    TOKKL_VERSION_STRING="${TOKKL_RESOLVED_VERSION}"
)
target_link_libraries(tokklcore
    PUBLIC
        Qt6::Core
        Qt6::Gui
        Qt6::Network
    PRIVATE
        KF6::Wallet
)
# The QML module's type registrar reads these for the QML_FOREIGN types.
qt6_extract_metatypes(tokklcore)

ecm_add_qml_module(tokklbackend
    URI ${TOKKL_BACKEND_URI}
    GENERATE_PLUGIN_SOURCE
    DEPENDENCIES QtQml
)

target_sources(tokklbackend PRIVATE
    companion.cpp
    companion.h
    qmltypes.h
)

target_compile_definitions(tokklbackend PRIVATE
    TOKKL_VERSION_STRING="${TOKKL_RESOLVED_VERSION}"
)

target_link_libraries(tokklbackend PRIVATE
    tokklcore
    Qt6::Core
    Qt6::Network
    Qt6::Qml
)

ecm_finalize_qml_module(tokklbackend DESTINATION ${KDE_INSTALL_QMLDIR})
