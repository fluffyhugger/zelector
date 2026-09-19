*** Settings ***
Library           SeleniumLibrary

*** Variables ***
# fastest for the browser to resolve
${FILE_MENU}            id:file-menu
# fastest for the browser to resolve
${EXPORT}               id:export
# fastest for the browser to resolve
${CARD_1}               id:card-1
# fastest for the browser to resolve
${DONE}                 id:done
${BROWSER}              chrome
${START_URL}            https://example.com/board

*** Test Cases ***
Move A Card
    [Documentation]    Recorded from https://example.com/board on 2026-09-18.
    Open Browser    ${START_URL}    ${BROWSER}
    Maximize Browser Window
    Mouse Over    ${FILE_MENU}
    Click Export
    Drag And Drop    ${CARD_1}    ${DONE}
    [Teardown]    Close Browser

*** Keywords ***
Click Export
    Wait Until Element Is Visible    ${EXPORT}    timeout=10s
    Click Button    ${EXPORT}
