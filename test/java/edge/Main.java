package com.mycompany.app;

import java.util.*;
import software.constructs.Construct;

import com.hashicorp.cdktf.*;
import imports.edgeprovider.*;

// Using references to resource attributes as resource arguments
class ReferenceStack extends TerraformStack {
    public ReferenceStack(Construct scope, String id) {
        super(scope, id);

        EdgeProvider.Builder.create(this, "edge")
                .reqstr("reqstr")
                .reqnum(123)
                .reqbool(true)
                .build();

        List<ListBlockResourceReq> arrlist = new ArrayList<ListBlockResourceReq>();
        arrlist.add(ListBlockResourceReq.builder().reqbool(true).reqnum(1).reqstr("reqstr").build());
        arrlist.add(ListBlockResourceReq.builder().reqbool(false).reqnum(0).reqstr("reqstr2").build());

        OptionalAttributeResource res = OptionalAttributeResource.Builder.create(this, "test").build();
        ListBlockResource list = ListBlockResource.Builder.create(this, "list").req(arrlist)
                .singlereq(ListBlockResourceSinglereq.builder().reqbool(true).reqnum(1).reqstr("reqstr").build())
                .build();

        // plain values
        RequiredAttributeResource.Builder.create(this, "plain")
                .bool(true) // res.getBool();
                .str(res.getStr())
                .num(res.getNum())
                .build();

        // required values FROM required single item lists
        RequiredAttributeResource.Builder.create(this, "from_single_list")
                .bool(true) // list.getSinglereq().getReqbool();
                .str(list.getSinglereq().getReqstr())
                .num(list.getSinglereq().getReqnum())
                .build();

        // required values FROM required multi item lists
        // RequiredAttributeResource.Builder.create(this, "from_list")
        //         .bool(Fn.lookup(Fn.element(list.getReq(), 0), "reqbool", false))
        //         .str(Token.asString(Fn.lookup(Fn.element(list.getReq(), 0), "reqstr", "fallback")))
        //         .num(Token.asNumber(Fn.lookup(Fn.element(list.getReq(), 0), "reqnum", 0)))
        //         .build();

        // passing a reference to a complete list
        // ListBlockResource.Builder.create(this, "list_reference")
        //         .req(Collections.emptyList()) // .req(list.getReq())
        //         .singlereq(list.getSinglereq())
        //         .build();

        // passing a literal array with references for a list
        // ListBlockResource.Builder.create(this, "list_literal")
        //         .req(Collections.singletonList(list.getSinglereq()))
        //         .singlereq(list.getSinglereq())
        //         .build();
    }
}

// CDKTF supports referencing inputs from providers (Terraform does not)
class ProviderStack extends TerraformStack {
    public ProviderStack(Construct scope, String id) {
        super(scope, id);
        EdgeProvider providerOpt = EdgeProvider.Builder.create(this, "edge")
                .reqstr("reqstr")
                .reqnum(123)
                .reqbool(true)
                .build();

        EdgeProvider providerFull = EdgeProvider.Builder.create(this, "edge_full")
                .reqstr("reqstr")
                .reqnum(123)
                .reqbool(true)
                .optstr("optstr")
                .optnum(456)
                .optbool(false)
                .computedstr("computedstr")
                .computednum(789)
                .computedbool(true)
                .alias("full")
                .build();

        // TODO: this currently does not compile because provider.reqbool may be undefined
        // although it is required to be set and therefor never actually is undefined
        RequiredAttributeResource.Builder.create(this, "reqOpt")
                // .bool(providerOpt.getReqbool())
                .bool(true)
                .num(Token.asNumber(providerOpt.getReqnum()))
                .str(Token.asString(providerOpt.getReqstr()))
                .build();

        OptionalAttributeResource.Builder.create(this, "optOpt")
                // .bool(providerOpt.getOptbool())
                .str(Token.asString(providerOpt.getOptstr()))
                .num(Token.asNumber(providerOpt.getOptnum()))
                .build();

        OptionalAttributeResource.Builder.create(this, "computedOpt")
                // .bool(providerOpt.getComputedbool())
                .str(Token.asString(providerOpt.getComputedstr()))
                .num(Token.asNumber(providerOpt.getComputednum()))
                .build();

        RequiredAttributeResource.Builder.create(this, "reqFull")
                // .bool(providerFull.getReqbool())
                .bool(true)
                .num(Token.asNumber(providerFull.getReqnum()))
                .str(Token.asString(providerFull.getReqstr()))
                .build();

        OptionalAttributeResource.Builder.create(this, "optFull")
                // .bool(providerFull.getOptbool())
                .str(Token.asString(providerFull.getOptstr()))
                .num(Token.asNumber(providerFull.getOptnum()))
                .build();

        OptionalAttributeResource.Builder.create(this, "computedFull")
                // .bool(providerFull.getComputedbool())
                .str(Token.asString(providerFull.getComputedstr()))
                .num(Token.asNumber(providerFull.getComputednum()))
                .build();
    }
}

public class Main extends TerraformStack
{
    public Main(Construct scope, String id) {
        super(scope, id);
    }

    public static void main(String[] args) {
        final App app = Testing.stubVersion(App.Builder.create().stackTraces(false).build());
        new ReferenceStack(app, "reference");
        new ProviderStack(app, "provider");
        app.synth();
    }
}