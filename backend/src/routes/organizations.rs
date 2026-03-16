use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::{error::{AppError, Result}, AppState};

pub async fn list_organizations(State(state): State<AppState>) -> Result<Json<Value>> {
    let rows: Vec<OrgRow> = sqlx::query_as(
        "SELECT id, name, sort_order, created_at, updated_at FROM organizations ORDER BY sort_order, name",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(serde_json::to_value(rows)?))
}

#[derive(Deserialize)]
pub struct CreateOrgBody {
    pub name: String,
}

pub async fn create_organization(
    State(state): State<AppState>,
    Json(body): Json<CreateOrgBody>,
) -> Result<Json<Value>> {
    if body.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO organizations (id, name) VALUES (?, ?)",
    )
    .bind(&id)
    .bind(&body.name)
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("Organization name already exists or DB error: {e}")))?;

    let org: OrgRow = sqlx::query_as(
        "SELECT id, name, sort_order, created_at, updated_at FROM organizations WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::to_value(org)?))
}

pub async fn get_organization(
    Path(org_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let org: Option<OrgRow> = sqlx::query_as(
        "SELECT id, name, sort_order, created_at, updated_at FROM organizations WHERE id = ?",
    )
    .bind(&org_id)
    .fetch_optional(&state.db)
    .await?;

    match org {
        Some(o) => Ok(Json(serde_json::to_value(o)?)),
        None => Err(AppError::NotFound(format!("Organization {org_id} not found"))),
    }
}

#[derive(Deserialize)]
pub struct UpdateOrgBody {
    pub name: Option<String>,
    #[serde(rename = "sortOrder")]
    pub sort_order: Option<i64>,
}

pub async fn update_organization(
    Path(org_id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<UpdateOrgBody>,
) -> Result<Json<Value>> {
    if let Some(name) = &body.name {
        sqlx::query(
            "UPDATE organizations SET name = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(name)
        .bind(&org_id)
        .execute(&state.db)
        .await?;
    }

    if let Some(order) = body.sort_order {
        sqlx::query(
            "UPDATE organizations SET sort_order = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(order)
        .bind(&org_id)
        .execute(&state.db)
        .await?;
    }

    let org: OrgRow = sqlx::query_as(
        "SELECT id, name, sort_order, created_at, updated_at FROM organizations WHERE id = ?",
    )
    .bind(&org_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::to_value(org)?))
}

pub async fn delete_organization(
    Path(org_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    sqlx::query("DELETE FROM organizations WHERE id = ?")
        .bind(&org_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(sqlx::FromRow, serde::Serialize)]
struct OrgRow {
    id: String,
    name: String,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}
