# Kept out of tokklcore, which needs Qt Core and Network only. After
# find_package(Qt6Keychain): add_subdirectory("${TOKKL_CORE_DIR}/keychain" keychain)

add_library(tokklqtkeychain STATIC
    qtkeychainstore.cpp
    qtkeychainstore.h
)
set_target_properties(tokklqtkeychain PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(tokklqtkeychain PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(tokklqtkeychain
    PUBLIC
        tokklcore
        Qt6Keychain::Qt6Keychain
)
