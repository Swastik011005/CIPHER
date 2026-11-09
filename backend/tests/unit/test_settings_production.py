"""Runtime settings: the local-only defaults, and what a production deployment must say explicitly."""

from __future__ import annotations

import pytest

from netsec.config import DEV_CORS_ORIGINS, ConfigError, Settings, load_settings, parse_origin


def settings(tmp_path, **env: str) -> Settings:
    return load_settings(env=env, dotenv_path=tmp_path / "no.env")


PRODUCTION = {"NETSEC_ENV": "production"}
PUBLIC = {"NETSEC_ENV": "production", "NETSEC_HOST": "0.0.0.0", "NETSEC_ALLOW_PUBLIC_BIND": "true"}


# -- the local-only defaults are unchanged ------------------------------------------------------------------


def test_development_defaults_are_local_only_and_unchanged(tmp_path) -> None:
    s = settings(tmp_path)
    assert (s.environment, s.host, s.port, s.production, s.public_bind) == ("development", "127.0.0.1", 8000, False, False)
    assert s.cors_origins == DEV_CORS_ORIGINS == ("http://localhost:5173", "http://127.0.0.1:5173")
    assert (s.enable_docs, s.rules_read_only, s.rate_limit_enabled, s.trust_proxy) == (True, False, False, False)
    assert s == Settings()  # the dataclass defaults are the development settings


@pytest.mark.parametrize("host", ["0.0.0.0", "192.168.1.5", "::", "example.com"])
def test_a_non_loopback_host_is_refused_by_default(tmp_path, host: str) -> None:
    with pytest.raises(ConfigError, match="not a loopback address"):
        settings(tmp_path, NETSEC_HOST=host)


# -- public binding needs an explicit production configuration -----------------------------------------------


def test_public_binding_needs_production_and_the_explicit_flag(tmp_path) -> None:
    with pytest.raises(ConfigError, match="NETSEC_ALLOW_PUBLIC_BIND"):
        settings(tmp_path, NETSEC_ENV="production", NETSEC_HOST="0.0.0.0")  # production alone is not enough
    with pytest.raises(ConfigError, match="not a loopback address"):
        settings(tmp_path, NETSEC_ENV="development", NETSEC_HOST="0.0.0.0", NETSEC_ALLOW_PUBLIC_BIND="true")  # the flag alone is not enough
    with pytest.raises(ConfigError, match="not a loopback address"):
        settings(tmp_path, NETSEC_HOST="0.0.0.0", NETSEC_ALLOW_PUBLIC_BIND="true")


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "10.1.2.3"])
def test_production_with_the_flag_may_bind_publicly(tmp_path, host: str) -> None:
    s = settings(tmp_path, **{**PUBLIC, "NETSEC_HOST": host})
    assert s.host == host and s.public_bind and s.production


def test_a_public_host_must_be_an_ip_address(tmp_path) -> None:
    with pytest.raises(ConfigError, match="IP address"):
        settings(tmp_path, **{**PUBLIC, "NETSEC_HOST": "example.com"})


def test_production_on_a_loopback_host_needs_no_public_flag(tmp_path) -> None:
    s = settings(tmp_path, **PRODUCTION)
    assert s.host == "127.0.0.1" and not s.public_bind


def test_unknown_environment_names_are_refused(tmp_path) -> None:
    with pytest.raises(ConfigError, match="NETSEC_ENV"):
        settings(tmp_path, NETSEC_ENV="staging")


# -- PORT -----------------------------------------------------------------------------------------------------


def test_the_platform_port_is_used_in_production_only(tmp_path) -> None:
    assert settings(tmp_path, **PRODUCTION, PORT="10000").port == 10000
    assert settings(tmp_path, PORT="3000").port == 8000  # a stray PORT in a developer's shell must not move the server


def test_netsec_port_wins_over_the_platform_port(tmp_path) -> None:
    assert settings(tmp_path, **PRODUCTION, PORT="10000", NETSEC_PORT="9001").port == 9001


@pytest.mark.parametrize("value", ["abc", "0", "70000", "-1"])
def test_a_bad_port_is_refused_and_named(tmp_path, value: str) -> None:
    with pytest.raises(ConfigError, match="PORT"):
        settings(tmp_path, **PRODUCTION, PORT=value)


# -- production defaults lean to the safe side ----------------------------------------------------------------


def test_production_defaults(tmp_path) -> None:
    s = settings(tmp_path, **PRODUCTION)
    assert s.cors_origins == ()  # no cross-origin caller until one is listed
    assert (s.enable_docs, s.rules_read_only, s.rate_limit_enabled) == (False, True, True)
    assert (s.trust_proxy, s.trusted_proxy_hops) == (False, 1)


def test_production_defaults_can_be_changed_only_explicitly(tmp_path) -> None:
    s = settings(tmp_path, **PRODUCTION, NETSEC_RULES_READ_ONLY="false", NETSEC_ENABLE_DOCS="1", NETSEC_RATE_LIMIT="off")
    assert (s.rules_read_only, s.enable_docs, s.rate_limit_enabled) == (False, True, False)


@pytest.mark.parametrize("value", ["maybe", "2", "tru"])
def test_flags_accept_only_clear_values(tmp_path, value: str) -> None:
    with pytest.raises(ConfigError, match="true or false"):
        settings(tmp_path, NETSEC_RULES_READ_ONLY=value)


def test_limits_are_configurable_and_validated(tmp_path) -> None:
    s = settings(tmp_path, **PRODUCTION, NETSEC_RATE_LIMIT_RUN_PER_MIN="5", NETSEC_RATE_LIMIT_VALIDATE_PER_MIN="1", NETSEC_RATE_LIMIT_API_PER_MIN="60", NETSEC_MAX_BODY_BYTES="2048")
    assert (s.rate_run_per_min, s.rate_validate_per_min, s.rate_api_per_min, s.max_body_bytes) == (5, 1, 60, 2048)
    for name, bad in [("NETSEC_RATE_LIMIT_RUN_PER_MIN", "0"), ("NETSEC_MAX_BODY_BYTES", "10"), ("NETSEC_TRUSTED_PROXY_HOPS", "0"), ("NETSEC_RATE_LIMIT_API_PER_MIN", "x")]:
        with pytest.raises(ConfigError, match=name):
            settings(tmp_path, **PRODUCTION, **{name: bad})


def test_summary_describes_the_exposure_without_secrets(tmp_path) -> None:
    summary = settings(tmp_path, **PUBLIC, NETSEC_TRUST_PROXY="true").summary()
    assert summary["environment"] == "production" and summary["rules_read_only"] is True and summary["docs"] is False
    assert summary["trust_proxy"] == "last 1 hop(s)" and summary["rate_limit"]["run"] == 20


# -- CORS origins ---------------------------------------------------------------------------------------------


def test_cors_origins_are_parsed_deduplicated_and_cleaned(tmp_path) -> None:
    s = settings(tmp_path, **PRODUCTION, NETSEC_CORS_ORIGINS=" https://cipher.onrender.com/ , https://cipher.onrender.com,https://other.example.com:8443 ")
    assert s.cors_origins == ("https://cipher.onrender.com", "https://other.example.com:8443")


def test_an_explicit_cors_list_replaces_the_development_default(tmp_path) -> None:
    assert settings(tmp_path, NETSEC_CORS_ORIGINS="http://localhost:3000").cors_origins == ("http://localhost:3000",)
    assert settings(tmp_path, NETSEC_CORS_ORIGINS="").cors_origins == ()


@pytest.mark.parametrize(
    "origin",
    ["*", "https://*.example.com", "https://app.example.com/path", "https://app.example.com/?x=1", "app.example.com", "ftp://app.example.com",
     "https://user:pw@app.example.com", "https://app.example.com:notaport", "null", "https://"],
)
def test_malformed_or_wildcard_origins_are_refused(origin: str) -> None:
    with pytest.raises(ConfigError, match="NETSEC_CORS_ORIGINS"):
        parse_origin(origin, production=False)


def test_production_origins_must_be_https_except_on_loopback() -> None:
    with pytest.raises(ConfigError, match="https"):
        parse_origin("http://app.example.com", production=True)
    assert parse_origin("http://127.0.0.1:8301", production=True) == "http://127.0.0.1:8301"
    assert parse_origin("http://localhost:5173", production=True) == "http://localhost:5173"
    assert parse_origin("http://app.example.com", production=False) == "http://app.example.com"


# -- the example files are loadable as they stand ---------------------------------------------------------------


def test_the_example_env_files_load_through_the_real_reader() -> None:
    from netsec.config import BACKEND_DIR

    development = load_settings(env={}, dotenv_path=BACKEND_DIR / ".env.example")
    assert development == Settings(log_level="info")  # the development example changes nothing from the defaults

    production = load_settings(env={}, dotenv_path=BACKEND_DIR / ".env.production.example")
    assert production.production and production.public_bind and production.host == "0.0.0.0"
    assert production.cors_origins == ("https://cipher.onrender.com",)
    assert (production.rules_read_only, production.enable_docs, production.rate_limit_enabled, production.trust_proxy) == (True, False, True, False)  # proxy trust is off until verified
    assert (production.rate_run_per_min, production.rate_validate_per_min, production.rate_api_per_min) == (20, 3, 240)


# -- the optional trusted client-address header -----------------------------------------------------------------


def test_a_client_ip_header_needs_proxy_trust_and_a_plain_header_name(tmp_path) -> None:
    ok = settings(tmp_path, **PRODUCTION, NETSEC_TRUST_PROXY="true", NETSEC_CLIENT_IP_HEADER="CF-Connecting-IP")
    assert ok.client_ip_header == "cf-connecting-ip" and ok.summary()["trust_proxy"] == "header cf-connecting-ip"
    assert settings(tmp_path, **PRODUCTION).client_ip_header is None
    with pytest.raises(ConfigError, match="NETSEC_TRUST_PROXY=true"):
        settings(tmp_path, **PRODUCTION, NETSEC_CLIENT_IP_HEADER="cf-connecting-ip")  # naming a header is not trusting the proxy
    with pytest.raises(ConfigError, match="header name"):
        settings(tmp_path, **PRODUCTION, NETSEC_TRUST_PROXY="true", NETSEC_CLIENT_IP_HEADER="x forwarded: for")


def test_serving_the_front_end_is_on_by_default_and_can_be_switched_off(tmp_path) -> None:
    assert settings(tmp_path).serve_frontend is True and settings(tmp_path, **PRODUCTION).serve_frontend is True
    assert settings(tmp_path, **PRODUCTION, NETSEC_SERVE_FRONTEND="false").serve_frontend is False
