# Qt Multimedia is linked here only; the core never sees it.
add_library(tokklkde STATIC
    alarmplayer.cpp
    alarmplayer.h
    appletpomodorostore.cpp
    appletpomodorostore.h
    kdeconnection.cpp
    kdeconnection.h
    kdetimerstate.cpp
    kdetimerstate.h
    kwalletcredentialstore.cpp
    kwalletcredentialstore.h
    pomodorolengthsclient.cpp
    pomodorolengthsclient.h
    pomodorolengthssaves.cpp
    pomodorolengthssaves.h
    pomodorosoundcatalogue.cpp
    pomodorosoundcatalogue.h
)
set_target_properties(tokklkde PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_compile_definitions(tokklkde PRIVATE
    TOKKL_PLASMOID_ID="${TOKKL_PLASMOID_ID}"
)
# Public: alarmplayer.h includes Qt Multimedia headers.
target_link_libraries(tokklkde
    PUBLIC
        tokklcore
        Qt6::Multimedia
    PRIVATE
        KF6::Wallet
        Plasma::Plasma
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
# The core's tr() catalog; QML strings use KI18n (see translations.h).
ecm_create_qm_loader(tokklbackend tokklcore_qt)

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
