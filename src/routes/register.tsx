import { useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { BLOOD_GROUPS, type BloodGroup } from "@/lib/blood";

import { register, type Role } from "@/lib/store";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      {
        title: "Register as a Blood Donor — BloodBridge",
      },

      {
        name: "description",
        content: "Join BloodBridge as a donor or as a patient/hospital seeker.",
      },

      {
        property: "og:title",
        content: "Register as a Blood Donor — BloodBridge",
      },

      {
        property: "og:description",
        content: "Create a BloodBridge account.",
      },
    ],
  }),

  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();

  const [role, setRole] = useState<Role>("donor");

  const [name, setName] = useState("");

  const [email, setEmail] = useState("");

  const [phone, setPhone] = useState("");

  const [password, setPassword] = useState("");

  const [confirmPassword, setConfirmPassword] = useState("");

  const [bloodGroup, setBloodGroup] = useState<BloodGroup>("O+");

  const [area, setArea] = useState("");

  const [lastDonation, setLastDonation] = useState("");

  const [available, setAvailable] = useState(true);

  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim() || !email.trim() || !phone.trim()) {
      toast.error("Name, email and phone are required.");

      return;
    }

    if (!password.trim()) {
      toast.error("Password is required.");

      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");

      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");

      return;
    }

    if (role === "donor" && !area.trim()) {
      toast.error("Tell us your area so we can measure distance.");

      return;
    }

    try {
      setLoading(true);

      const user = await register(
        {
          role,

          name: name.trim(),

          email: email.trim(),

          phone: phone.trim(),

          password,
        },

        role === "donor"
          ? {
              bloodGroup,

              area: area.trim(),

              lastDonationDate: lastDonation || null,

              available,
            }
          : undefined,
      );

      toast.success(
        role === "donor"
          ? "Your donor account has been created."
          : "Your account has been created.",
      );

      navigate({
        to: "/dashboard",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shell flex justify-center py-16">
      <Card className="w-full max-w-xl gap-5 p-7 shadow-lift">
        <div>
          <h1 className="font-display text-4xl">Create your account</h1>

          <p className="mt-1 text-sm text-muted-foreground">
            Donors get matched to nearby emergencies. Seekers can post requests instantly.
          </p>
        </div>

        <Tabs value={role} onValueChange={(value) => setRole(value as Role)}>
          <TabsList className="w-full">
            <TabsTrigger value="donor" className="flex-1">
              I want to donate
            </TabsTrigger>

            <TabsTrigger value="seeker" className="flex-1">
              I need blood
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="name"
              label="Full name"
              value={name}
              onChange={setName}
              placeholder="Aarav Mehta"
            />

            <Field
              id="phone"
              label="Phone"
              value={phone}
              onChange={setPhone}
              placeholder="+91 98490 00000"
            />
          </div>

          <Field
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="Minimum 6 characters"
            />

            <Field
              id="confirmPassword"
              label="Confirm password"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Re-enter password"
            />
          </div>

          {role === "donor" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Blood group</Label>

                  <Select
                    value={bloodGroup}
                    onValueChange={(value) => setBloodGroup(value as BloodGroup)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      {BLOOD_GROUPS.map((group) => (
                        <SelectItem key={group} value={group}>
                          {group}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Field
                  id="area"
                  label="Area / locality"
                  value={area}
                  onChange={setArea}
                  placeholder="Banjara Hills"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="last">Last donation date (optional)</Label>

                  <Input
                    id="last"
                    type="date"
                    value={lastDonation}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setLastDonation(e.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <Label className="text-sm font-semibold">Available now</Label>

                    <p className="text-xs text-muted-foreground">You can pause anytime.</p>
                  </div>

                  <Switch checked={available} onCheckedChange={setAvailable} />
                </div>
              </div>
            </>
          )}

          <Button type="submit" size="lg" disabled={loading}>
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already registered?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>

      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
