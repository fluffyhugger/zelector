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
    Set Window Size    1512    944
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
    Execute Async Javascript
    ...    const el = arguments[0], done = arguments[arguments.length - 1];
    ...    let last = null, still = 0, frames = 0;
    ...    const inView = (r) => r.bottom > 0 && r.right > 0
    ...    && r.top < innerHeight && r.left < innerWidth;
    ...    const tick = () => {
    ...    const r = el.getBoundingClientRect();
    ...    const now = [r.x, r.y, r.width, r.height].join();
    ...    still = now === last && inView(r) ? still + 1 : 0;
    ...    last = now;
    ...    if (still >= 2 || ++frames > 600) {
    ...    el.scrollIntoView({block: 'center', behavior: 'instant'});
    ...    return done(still >= 2);
    ...    }
    ...    requestAnimationFrame(tick);
    ...    };
    ...    requestAnimationFrame(tick);
    ...    ARGUMENTS    ${el}

Click State Select
    Wait Until Element Is Visible    ${STATE_SELECT}    timeout=10s
    Bring Into View    ${STATE_SELECT}
    Click Element    ${STATE_SELECT}

Click Submit
    Wait Until Element Is Visible    ${SUBMIT}    timeout=10s
    Bring Into View    ${SUBMIT}
    Click Button    ${SUBMIT}
