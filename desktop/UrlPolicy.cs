using System;

internal static class UrlPolicy
{
    internal static readonly Uri Site = new Uri("https://share.detrouse.com/");

    internal static bool TryParse(string value, out Uri uri)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out uri)
            && !String.IsNullOrEmpty(uri.Host)
            && String.IsNullOrEmpty(uri.UserInfo)
            && (uri.Scheme == Uri.UriSchemeHttps
                || (uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback));
    }

    internal static bool SameOrigin(Uri left, Uri right)
    {
        return left.Scheme == right.Scheme && left.Host == right.Host && left.Port == right.Port;
    }
}
