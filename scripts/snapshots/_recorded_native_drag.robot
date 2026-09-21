*** Settings ***
Library           SeleniumLibrary
Suite Setup       Open The Browser
Suite Teardown    Close Browser

*** Variables ***
# fastest for the browser to resolve
${CARD_1}               id:card-1
# fastest for the browser to resolve
${DONE}                 id:done
${BROWSER}              chrome
${START_URL}            https://example.com/board

*** Test Cases ***
Move A Card
    [Documentation]    Recorded from https://example.com/board on 2026-09-21.
    [Tags]    recorded    example
    Drag And Drop (Native)    ${CARD_1}    ${DONE}

*** Keywords ***
Drag And Drop (Native)
    [Arguments]    ${arg_source}    ${arg_target}
    ${src}=    Get WebElement    ${arg_source}
    ${dst}=    Get WebElement    ${arg_target}
    Execute Javascript
    ...    const [src, dst] = arguments;
    ...    const dt = new DataTransfer();
    ...    const fire = (el, type) => el.dispatchEvent(
    ...    new DragEvent(type, {bubbles: true, cancelable: true, dataTransfer: dt}));
    ...    fire(src, 'dragstart');
    ...    fire(dst, 'dragenter');
    ...    fire(dst, 'dragover');
    ...    fire(dst, 'drop');
    ...    fire(src, 'dragend');
    ...    ARGUMENTS    ${src}    ${dst}

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
