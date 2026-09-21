*** Settings ***
Library           SeleniumLibrary
Suite Setup       Open The Browser
Suite Teardown    Close Browser

*** Variables ***
# form field name — tied to the backend contract
${CARD_NUMBER}          name:card_number
# fastest for the browser to resolve
${PAY_NOW}              id:pay-now
# no stable attribute found — consider asking for a data-testid
${SPINNER}              css:.spinner
# fastest for the browser to resolve
${CONFIRM}              id:confirm
# fastest for the browser to resolve
${RECEIPT}              id:receipt
# Selenium needs Select Frame to reach inside
${CHECKOUT_FRAME}       id:checkout-frame
${BROWSER}              chrome
${START_URL}            https://shop.example.com/checkout

*** Test Cases ***
Pay With Card
    [Documentation]    Recorded from https://shop.example.com/checkout on 2026-09-14.
    [Tags]    recorded    example
    Fill Card Number    4111111111111111
    Click Pay Now
    Wait Until Element Is Visible    ${RECEIPT}    timeout=15s
    Click Confirm

*** Keywords ***
Fill Card Number
    [Arguments]    ${arg_text}
    Select Frame    ${CHECKOUT_FRAME}
    Wait Until Element Is Visible    ${CARD_NUMBER}    timeout=10s
    Input Text    ${CARD_NUMBER}    ${arg_text}
    Unselect Frame

Click Pay Now
    Select Frame    ${CHECKOUT_FRAME}
    Wait Until Element Is Not Visible    ${SPINNER}    timeout=20s
    Wait Until Element Is Visible    ${PAY_NOW}    timeout=10s
    Click Button    ${PAY_NOW}
    Unselect Frame

Click Confirm
    Select Frame    ${CHECKOUT_FRAME}
    Wait Until Element Is Visible    ${CONFIRM}    timeout=10s
    Click Button    ${CONFIRM}
    Unselect Frame

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
