*** Settings ***
Library           SeleniumLibrary
Suite Setup       Open The Browser
Suite Teardown    Close Browser

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
    [Tags]    recorded    example
    Click Save
    Handle Alert    action=ACCEPT
    Click Delete
    Handle Alert    action=DISMISS
    Click Rename
    Input Text Into Alert    a\ \ b \${X}    action=ACCEPT

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
