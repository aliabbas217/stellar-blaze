"""Base class for response bodies."""

from pydantic import BaseModel, ConfigDict


class ResponseModel(BaseModel):
    """Base of every response body.

    Pydantic lists a field with a default as optional in the response schema, even though the API always sends it. The
    OpenAPI snapshot is the contract the frontend's TypeScript client is generated from, so a field the API always
    sends must be ``required`` there; ``json_schema_serialization_defaults_required`` says so for every field.
    """

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)
