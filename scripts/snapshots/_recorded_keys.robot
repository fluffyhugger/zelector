*** Settings ***
Library           SeleniumLibrary
Suite Setup       Open The Browser
Suite Teardown    Close Browser

*** Variables ***
# fastest for the browser to resolve
${Q}                    id:q
# fastest for the browser to resolve
${AVATAR}               id:avatar
# no stable attribute found — consider asking for a data-testid
${PROSEMIRROR}          css:div
# fastest for the browser to resolve
${MENU}                 id:menu
# the file chosen while recording — put it beside this suite, or pass --variable FILE_PATH:/full/path
${FILE_PATH}            ${CURDIR}${/}photo (1).png
${BROWSER}              chrome
${START_URL}            https://example.com/search

*** Test Cases ***
Search And Attach
    [Documentation]    Recorded from https://example.com/search on 2026-09-18.
    [Tags]    recorded    example
    Fill Q    shoes
    Press Keys    ${Q}    RETURN
    Upload Avatar    ${FILE_PATH}
    Press Keys    ${PROSEMIRROR}    \ buy\ \ milk
    Press Keys    ${MENU}    ESCAPE

*** Keywords ***
Fill Q
    [Arguments]    ${arg_text}
    Wait Until Element Is Visible    ${Q}    timeout=10s
    Input Text    ${Q}    ${arg_text}

Upload Avatar
    [Arguments]    ${arg_file_path}
    Wait Until Element Is Visible    ${AVATAR}    timeout=10s
    Choose File    ${AVATAR}    ${arg_file_path}

Open The Browser
    Open Browser    ${START_URL}    ${BROWSER}
    Maximize Browser Window
    Execute Async Javascript
    ...    const done = arguments[arguments.length - 1];
    ...    let timer = 0;
    ...    const finish = () => {
    ...    observer.disconnect();
    ...    clearTimeout(timer);
    ...    clearTimeout(cap);
    ...    done(true);
    ...    };
    ...    const observer = new MutationObserver(() => {
    ...    clearTimeout(timer);
    ...    timer = setTimeout(finish, 500);
    ...    });
    ...    observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true});
    ...    timer = setTimeout(finish, 500);
    ...    const cap = setTimeout(finish, 3000);
