# The backend QML module the widget imports. TT-0147 and TT-0148 add the API
# client, credential storage and timer state here.

ecm_add_qml_module(tokklbackend
    URI ${TOKKL_BACKEND_URI}
    GENERATE_PLUGIN_SOURCE
    DEPENDENCIES QtQml
)

target_sources(tokklbackend PRIVATE
    companion.cpp
    companion.h
)

target_compile_definitions(tokklbackend PRIVATE
    TOKKL_VERSION_STRING="${TOKKL_RESOLVED_VERSION}"
)

target_link_libraries(tokklbackend PRIVATE
    Qt6::Core
    Qt6::Network
    Qt6::Qml
    KF6::Wallet
)

ecm_finalize_qml_module(tokklbackend DESTINATION ${KDE_INSTALL_QMLDIR})
