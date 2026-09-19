*** Settings ***
Library           SeleniumLibrary

*** Variables ***
# fastest for the browser to resolve
${SAVE}                 id:save
# no stable attribute found — consider asking for a data-testid
${HTML}                 css:html
# fastest for the browser to resolve
${TOAST}                id:toast
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
    Wait Until Element Is Visible    ${TOAST}    timeout=10s
    Click HTML
    Click Delete
    Click HTML
    Click Rename
    Click HTML
    [Teardown]    Close Browser

*** Keywords ***
Click Save
    Wait Until Element Is Visible    ${SAVE}    timeout=10s
    Click Button    ${SAVE}

Click HTML
    Wait Until Element Is Visible    ${HTML}    timeout=10s
    Click Element    ${HTML}

Click Delete
    Wait Until Element Is Visible    ${DELETE}    timeout=10s
    Click Button    ${DELETE}

Click Rename
    Wait Until Element Is Visible    ${RENAME}    timeout=10s
    Click Button    ${RENAME}
