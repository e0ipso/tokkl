# The backend QML module the widget imports. The API client, the credential
# store interface, connection state and timer controller are the tokklcore
# library from desktop/core, which the module and the tests link. The
# tokklkde library adds KDE Wallet and the types QML creates; qmltypes.h
# gives the classes their QML names.

# The KDE side: the KDE Wallet store, the connection types the widget
# creates from QML, which inject it, the pause chain and Pomodoro stores in
# the widget's own configuration, the Pomodoro session wiring and the alarm
# player. Qt Multimedia is linked here only; the core never sees it.
add_library(tokklkde STATIC
    alarmplayer.cpp
    alarmplayer.h
    appletchainstore.cpp
    appletchainstore.h
    appletpomodorostore.cpp
    appletpomodorostore.h
    kdeconnection.cpp
    kdeconnection.h
    kdepomodoro.cpp
    kdepomodoro.h
    kwalletcredentialstore.cpp
    kwalletcredentialstore.h
    pomodorolengthsclient.cpp
    pomodorolengthsclient.h
    pomodorosoundcatalogue.cpp
    pomodorosoundcatalogue.h
)
set_target_properties(tokklkde PROPERTIES POSITION_INDEPENDENT_CODE ON)
# The alarm player finds the installed widget's sounds by the widget's id.
target_compile_definitions(tokklkde PRIVATE
    TOKKL_PLASMOID_ID="${TOKKL_PLASMOID_ID}"
)
# Multimedia and Qml are public: the headers of the alarm player and the
# Pomodoro wiring include theirs.
target_link_libraries(tokklkde
    PUBLIC
        tokklcore
        Qt6::Multimedia
        Qt6::Qml
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
