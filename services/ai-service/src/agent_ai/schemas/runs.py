from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from agent_ai.models import Category, RequestedCategory


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=False)


class InternalCreateRunRequest(ContractModel):
    run_id: str = Field(alias="runId", min_length=1, max_length=200)
    query: str = Field(min_length=3, max_length=2000)
    requested_category: RequestedCategory = Field(alias="requestedCategory")
    locale: Literal["ar-EG", "en-EG"]
    market: Literal["EG"]
    currency: Literal["EGP"]
    timezone: Literal["Africa/Cairo"]
    browser_expires_at: datetime = Field(alias="browserExpiresAt")

    @field_validator("run_id", "query")
    @classmethod
    def reject_surrounding_whitespace(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("String values must not contain surrounding whitespace")
        return value

    @field_validator("browser_expires_at", mode="before")
    @classmethod
    def require_z_timestamp_text(cls, value: Any) -> Any:
        if not isinstance(value, str) or not value.endswith("Z"):
            raise ValueError("browserExpiresAt must end with Z")
        return value

    @field_validator("browser_expires_at")
    @classmethod
    def require_utc_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() != UTC.utcoffset(value):
            raise ValueError("browserExpiresAt must be an RFC 3339 UTC timestamp")
        return value


class InternalCreateRunResponse(ContractModel):
    run_id: str = Field(alias="runId")
    accepted: Literal[True] = True
    duplicate: bool


class CommandName(StrEnum):
    CLARIFY = "clarify"
    PAUSE = "pause"
    RESUME = "resume"
    CANCEL = "cancel"
    COMPLETE = "complete"
    APPROVE_DOMAINS = "approve_domains"
    GRANT_ADDRESS = "grant_address"
    APPROVE_SEAT_HOLD = "approve_seat_hold"


_PAYLOAD_KEYS: dict[CommandName, tuple[set[str], set[str]]] = {
    CommandName.CLARIFY: ({"requestId", "answers"}, set()),
    CommandName.PAUSE: ({"reason"}, set()),
    CommandName.RESUME: ({"reason"}, set()),
    CommandName.CANCEL: ({"reason"}, set()),
    CommandName.COMPLETE: ({"reason", "reportId"}, set()),
    CommandName.APPROVE_DOMAINS: ({"approvalId", "requestId", "domains"}, set()),
    CommandName.GRANT_ADDRESS: (
        {
            "approvalId",
            "requestId",
            "secretReference",
            "merchantDomains",
            "expiresAt",
        },
        set(),
    ),
    CommandName.APPROVE_SEAT_HOLD: (
        {"approvalId", "requestId", "merchantDomain", "offerId"},
        set(),
    ),
}


class InternalCommandRequest(ContractModel):
    id: str = Field(min_length=1, max_length=200)
    run_id: str = Field(alias="runId", min_length=1, max_length=200)
    name: CommandName
    issued_at: datetime = Field(alias="issuedAt")
    payload: dict[str, Any]

    @field_validator("id", "run_id")
    @classmethod
    def reject_blank_identifier(cls, value: str) -> str:
        if not value.strip() or value != value.strip():
            raise ValueError("Identifiers must be non-empty without surrounding whitespace")
        return value

    @field_validator("issued_at", mode="before")
    @classmethod
    def require_issued_at_z_text(cls, value: Any) -> Any:
        if not isinstance(value, str) or not value.endswith("Z"):
            raise ValueError("issuedAt must end with Z")
        return value

    @field_validator("issued_at")
    @classmethod
    def require_issued_at_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() != UTC.utcoffset(value):
            raise ValueError("issuedAt must be an RFC 3339 UTC timestamp")
        return value

    @model_validator(mode="after")
    def validate_exact_payload(self) -> InternalCommandRequest:
        required, optional = _PAYLOAD_KEYS[self.name]
        keys = set(self.payload)
        if missing := required - keys:
            raise ValueError(f"{self.name} payload is missing: {sorted(missing)}")
        if unknown := keys - required - optional:
            raise ValueError(f"{self.name} payload has unknown fields: {sorted(unknown)}")
        self._validate_payload_values()
        return self

    def _validate_payload_values(self) -> None:
        if self.name is CommandName.CLARIFY:
            answers = self.payload["answers"]
            _require_string(self.payload["requestId"], "requestId")
            if not isinstance(answers, dict) or not answers:
                raise ValueError("clarify requires requestId and answers")
            for question_id, answer in answers.items():
                _require_string(question_id, "answer question id")
                if isinstance(answer, str):
                    _require_string(answer, "answer")
                elif isinstance(answer, list) and answer:
                    for item in answer:
                        _require_string(item, "answer")
                else:
                    raise ValueError("clarification answers must be non-empty strings or arrays")
        elif self.name is CommandName.PAUSE:
            if self.payload["reason"] not in {"user", "control_claim", "safety"}:
                raise ValueError("Invalid pause reason")
        elif self.name is CommandName.RESUME:
            if self.payload["reason"] not in {"user", "control_release", "lease_expired"}:
                raise ValueError("Invalid resume reason")
        elif self.name is CommandName.CANCEL:
            reason = self.payload["reason"]
            if reason is not None and not isinstance(reason, str):
                raise ValueError("cancel reason must be a string or null")
        elif self.name is CommandName.COMPLETE:
            if self.payload["reason"] != "user_finished":
                raise ValueError("Invalid complete reason")
            _require_string(self.payload["reportId"], "reportId")
        elif self.name is CommandName.APPROVE_DOMAINS:
            _require_string(self.payload["approvalId"], "approvalId")
            _require_string(self.payload["requestId"], "requestId")
            _require_non_empty_strings(self.payload["domains"], "domains")
        elif self.name is CommandName.GRANT_ADDRESS:
            _require_string(self.payload["approvalId"], "approvalId")
            _require_string(self.payload["requestId"], "requestId")
            _require_string(self.payload["secretReference"], "secretReference")
            _require_non_empty_strings(self.payload["merchantDomains"], "merchantDomains")
            if not isinstance(self.payload["expiresAt"], str) or not self.payload[
                "expiresAt"
            ].endswith("Z"):
                raise ValueError("grant_address expiresAt must end with Z")
            try:
                expires_at = datetime.fromisoformat(
                    str(self.payload["expiresAt"]).replace("Z", "+00:00")
                )
            except ValueError as exc:
                raise ValueError("grant_address expiresAt must be an RFC 3339 timestamp") from exc
            if expires_at.tzinfo is None or expires_at <= datetime.now(UTC):
                raise ValueError("grant_address expiresAt must be in the future")
        elif self.name is CommandName.APPROVE_SEAT_HOLD:
            for field in ("approvalId", "requestId", "merchantDomain", "offerId"):
                _require_string(self.payload[field], field)


class InternalCommandResponse(ContractModel):
    id: str
    run_id: str = Field(alias="runId")
    accepted: Literal[True] = True
    duplicate: bool


def _require_non_empty_strings(value: Any, field: str) -> None:
    if not isinstance(value, list) or not value or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{field} must be a non-empty string array")
    if any(not item.strip() for item in value) or len(set(value)) != len(value):
        raise ValueError(f"{field} must contain unique non-empty strings")


def _require_string(value: Any, field: str) -> None:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise ValueError(f"{field} must be a non-empty string without surrounding whitespace")


# Internal aliases retained only for Python imports; the HTTP contract accepts no aliases.
RunCreateRequest = InternalCreateRunRequest
RunCommandRequest = InternalCommandRequest


def resolved_category(requested: RequestedCategory) -> Category | None:
    if requested is RequestedCategory.AUTO:
        return None
    return Category(requested.value)
