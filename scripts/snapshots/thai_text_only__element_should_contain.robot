*** Variables ***
# no stable attribute found — consider asking for a data-testid
${SPAN_TARGET}          css:span

*** Keywords ***
Span Target Should Contain
    Wait Until Element Is Visible    ${SPAN_TARGET}    timeout=10s
    Element Should Contain    ${SPAN_TARGET}    ${EXPECTED}
