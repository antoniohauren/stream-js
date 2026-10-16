using System;

internal static class UrlPolicyTests
{
    private static void Main()
    {
        foreach (string value in new[] { "https://share.example.com", "https://share.example.com/room-1?x=1#test",
            "http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787" })
        {
            Uri uri;
            if (!UrlPolicy.TryParse(value, out uri)) throw new Exception("Rejected: " + value);
        }
        foreach (string value in new[] { "", "not a URL", "http://share.example.com", "file:///C:/test",
            "javascript:alert(1)", "https://user:password@share.example.com", "data:text/html,test" })
        {
            Uri uri;
            if (UrlPolicy.TryParse(value, out uri)) throw new Exception("Accepted: " + value);
        }
        Uri site = new Uri("https://share.example.com");
        if (!UrlPolicy.SameOrigin(site, new Uri("https://SHARE.example.com:443/room-1")))
            throw new Exception("Same origin rejected");
        foreach (string value in new[] { "https://other.example.com", "http://share.example.com", "https://share.example.com:444" })
            if (UrlPolicy.SameOrigin(site, new Uri(value))) throw new Exception("Cross origin accepted: " + value);
        if (UrlPolicy.Site.AbsoluteUri != "https://share.detrouse.com/") throw new Exception("Incorrect fixed website");
        if (UrlPolicy.SameOrigin(UrlPolicy.Site, new Uri("https://other.example.com/")))
            throw new Exception("Fixed website allows a different origin");
        Console.WriteLine("Desktop URL policy: 18 checks passed.");
    }
}
