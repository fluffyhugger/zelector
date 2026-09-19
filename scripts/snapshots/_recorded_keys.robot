*** Settings ***
Library           SeleniumLibrary

*** Variables ***
# fastest for the browser to resolve
${Q}                    id:q
# fastest for the browser to resolve
${AVATAR}               id:avatar
# fastest for the browser to resolve
${MENU}                 id:menu
${BROWSER}              chrome
${START_URL}            https://example.com/search

*** Test Cases ***
Search And Attach
    [Documentation]    Recorded from https://example.com/search on 2026-09-18.
    Open Browser    ${START_URL}    ${BROWSER}
    Maximize Browser Window
    Fill Q    shoes
    Press Keys    ${Q}    RETURN
    # the file chosen while recording was photo (1).png
    Upload Avatar    ${FILE_PATH}
    Press Keys    ${MENU}    ESCAPE
    [Teardown]    Close Browser

*** Keywords ***
Fill Q
    [Arguments]    ${arg_text}
    Wait Until Element Is Visible    ${Q}    timeout=10s
    Input Text    ${Q}    ${arg_text}

Upload Avatar
    [Arguments]    ${arg_file_path}
    Wait Until Element Is Visible    ${AVATAR}    timeout=10s
    Choose File    ${AVATAR}    ${arg_file_path}
