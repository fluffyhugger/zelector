*** Settings ***
Library           SeleniumLibrary
Suite Setup       Open The Browser
Suite Teardown    Close Browser

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
    [Tags]    recorded    example
    Mouse Over    ${FILE_MENU}
    Click Export
    Drag And Drop    ${CARD_1}    ${DONE}

*** Keywords ***
Click Export
    Wait Until Element Is Visible    ${EXPORT}    timeout=10s
    Click Button    ${EXPORT}

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
