*** Variables ***
# no stable attribute found — consider asking for a data-testid
${SPAN_TARGET}          css:span

*** Keywords ***
Click Span Target
    Wait Until Element Is Visible    ${SPAN_TARGET}    timeout=10s
    Click Element    ${SPAN_TARGET}
