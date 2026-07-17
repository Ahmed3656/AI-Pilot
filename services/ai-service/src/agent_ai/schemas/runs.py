from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator

from agent_ai.models import ApprovalType, Category, RunStatus


class RunCreateRequest(BaseModel):
    run_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("run_id", "runId"),
        min_length=2,
        max_length=200,
    )
    category: Category | None = None
    query: str = Field(min_length=2, max_length=4000)
    market: Literal["EG"] = "EG"
    currency: Literal["EGP"] = "EGP"
    locale: Literal["ar", "en"] | None = None
    address_handle: str | None = None
    constraints: dict[str, Any] = Field(default_factory=dict)

    @field_validator("address_handle")
    @classmethod
    def validate_handle(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not re.fullmatch(r"[a-zA-Z0-9_.:/-]{2,200}", value):
            raise ValueError(
                "address_handle must be a semantic secret handle, not an address value"
            )
        return value

    @model_validator(mode="after")
    def reject_literal_address_constraints(self) -> RunCreateRequest:
        forbidden = {"address", "delivery_address", "street_address", "العنوان"}
        if any(key.casefold() in forbidden for key in self.constraints):
            raise ValueError("Put address data in address_handle, never in constraints")
        return self


class CommandType(StrEnum):
    CLARIFY = "clarify"
    APPROVE = "approve"
    RESUME = "resume"
    DENY = "deny"
    PAUSE = "pause"
    CANCEL = "cancel"
    APPROVE_DOMAINS = "approve_domains"
    GRANT_ADDRESS = "grant_address"
    APPROVE_SEAT_HOLD = "approve_seat_hold"


class RunCommandRequest(BaseModel):
    command: CommandType = Field(validation_alias=AliasChoices("command", "type"))
    text: str | None = Field(default=None, max_length=4000)
    approval_type: ApprovalType | None = None
    domains: list[str] = Field(default_factory=list)
    secret_reference: str | None = Field(
        default=None,
        validation_alias=AliasChoices("secret_reference", "secretReference"),
    )
    recipient_domains: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("recipient_domains", "recipientDomains"),
    )
    expires_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("expires_at", "expiresAt"),
    )
    merchant_domain: str | None = Field(
        default=None,
        validation_alias=AliasChoices("merchant_domain", "merchantDomain"),
    )
    offer_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("offer_id", "offerId"),
    )


class RunResponse(BaseModel):
    id: str
    run_id: str
    status: RunStatus
    category: Category | None = None
    clarification: str | None = None
    pending_approval: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime
