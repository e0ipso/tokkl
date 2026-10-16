# The backend QML module the widget imports. The API client, the credential
# store interface, connection state and timer controller are the tokklcore
# library from desktop/core, which the module and the tests link. The
# tokklkde library adds KDE Wallet and the types QML creates; qmltypes.h
# gives the classes their QML names.

# The KDE side: the KDE Wallet store and the connection types the widget
# creates from QML, which inject it.
add_library(tokklkde STATIC
    kdeconnection.cpp
    kdeconnection.h
    kwalletcredentialstore.cpp
    kwalletcredentialstore.h
)
set_target_properties(tokklkde PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_link_libraries(tokklkde
    PUBLIC
        tokklcore
    PRIVATE
        KF6::Wallet
)
qt6_extract_metatypes(tokklkde)

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
    tokklkde
    Qt6::Core
    Qt6::Network
    Qt6::Qml
)

ecm_finalize_qml_module(tokklbackend DESTINATION ${KDE_INSTALL_QMLDIR})
