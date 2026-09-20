*** Settings ***
Library           SeleniumLibrary

*** Variables ***
# fastest for the browser to resolve
${ADDRESS}              id:address
# fastest for the browser to resolve
${STATE_SELECT}         id:state-select
# fastest for the browser to resolve
${SUBMIT}               id:submit
${BROWSER}              chrome
${START_URL}            https://example.com/form

*** Test Cases ***
Under A Sticky Footer
    [Documentation]    Recorded from https://example.com/form on 2026-09-20.
    Open Browser    ${START_URL}    ${BROWSER}
    Maximize Browser Window
    Fill Address    somewhere
    Click State Select
    Click Submit
    [Teardown]    Close Browser

*** Keywords ***
Fill Address
    [Arguments]    ${arg_text}
    Wait Until Element Is Visible    ${ADDRESS}    timeout=10s
    Input Text    ${ADDRESS}    ${arg_text}

Bring Into View
    [Arguments]    ${arg_locator}
    ${el}=    Get WebElement    ${arg_locator}
    Execute Javascript    arguments[0].scrollIntoView({block: 'center', behavior: 'instant'})    ARGUMENTS    ${el}

Click State Select
    Wait Until Element Is Visible    ${STATE_SELECT}    timeout=10s
    Bring Into View    ${STATE_SELECT}
    Click Element    ${STATE_SELECT}

Click Submit
    Wait Until Element Is Visible    ${SUBMIT}    timeout=10s
    Bring Into View    ${SUBMIT}
    Click Button    ${SUBMIT}
