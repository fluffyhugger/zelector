*** Settings ***
Library           SeleniumLibrary

*** Variables ***
# fastest for the browser to resolve
${SAVE}                 id:save
# fastest for the browser to resolve
${DELETE}               id:delete
# fastest for the browser to resolve
${RENAME}               id:rename
${BROWSER}              chrome
${START_URL}            https://example.com/admin

*** Test Cases ***
Confirmations
    [Documentation]    Recorded from https://example.com/admin on 2026-09-18.
    Open Browser    ${START_URL}    ${BROWSER}
    Maximize Browser Window
    Click Save
    Handle Alert    action=ACCEPT
    Click Delete
    Handle Alert    action=DISMISS
    Click Rename
    Input Text Into Alert    a\ \ b \${X}    action=ACCEPT
    [Teardown]    Close Browser

*** Keywords ***
Click Save
    Wait Until Element Is Visible    ${SAVE}    timeout=10s
    Click Button    ${SAVE}

Click Delete
    Wait Until Element Is Visible    ${DELETE}    timeout=10s
    Click Button    ${DELETE}

Click Rename
    Wait Until Element Is Visible    ${RENAME}    timeout=10s
    Click Button    ${RENAME}
